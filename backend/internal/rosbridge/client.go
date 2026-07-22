// Package rosbridge implements a minimal rosbridge v2 protocol client:
// advertise/publish/subscribe framing over a WebSocket, with automatic
// reconnect. The daemon is the only owner of this client — the renderer
// never talks to the robot directly (spec §10.3 "never trust the client").
package rosbridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

// ConnState is the client's connection lifecycle state.
type ConnState int

const (
	Disconnected ConnState = iota
	Connecting
	Connected
)

func (s ConnState) String() string {
	switch s {
	case Connecting:
		return "Connecting"
	case Connected:
		return "Connected"
	default:
		return "Disconnected"
	}
}

// ErrNotConnected is returned by Publish when no live connection exists to
// send the message on. Subscribe/advertise state is queued and resent on
// the next successful connect regardless.
var ErrNotConnected = errors.New("rosbridge: not connected")

const (
	minBackoff   = 250 * time.Millisecond
	maxBackoff   = 4 * time.Second
	writeTimeout = 5 * time.Second
)

// nextBackoff doubles cur, capped at maxBackoff; cur == 0 starts at minBackoff.
func nextBackoff(cur time.Duration) time.Duration {
	if cur <= 0 {
		return minBackoff
	}
	next := cur * 2
	if next > maxBackoff {
		return maxBackoff
	}
	return next
}

type subscription struct {
	msgType string
	fn      func(json.RawMessage)
}

// Rosbridge v2 op frames. Separate types keep unused fields out of the
// wire JSON instead of relying on omitempty across a single shared struct.
type advertiseFrame struct {
	Op    string `json:"op"`
	Topic string `json:"topic"`
	Type  string `json:"type"`
}

type subscribeFrame struct {
	Op    string `json:"op"`
	Topic string `json:"topic"`
	Type  string `json:"type"`
}

type publishFrame struct {
	Op    string `json:"op"`
	Topic string `json:"topic"`
	Msg   any    `json:"msg"`
}

type inFrame struct {
	Op    string          `json:"op"`
	Topic string          `json:"topic"`
	Msg   json.RawMessage `json:"msg"`
}

// Client is a rosbridge v2 WebSocket client that reconnects with backoff.
// The zero value is not usable; construct with New.
type Client struct {
	url string

	mu         sync.Mutex
	state      ConnState
	conn       *websocket.Conn
	advertised map[string]string // topic -> msgType, resent on reconnect
	subs       map[string]subscription
}

// New creates a Client for the given rosbridge WebSocket URL. Call Connect
// to establish and maintain the connection.
func New(url string) *Client {
	return &Client{
		url:        url,
		advertised: make(map[string]string),
		subs:       make(map[string]subscription),
	}
}

// State reports the client's current connection state.
func (c *Client) State() ConnState {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state
}

func (c *Client) setState(s ConnState) {
	c.mu.Lock()
	c.state = s
	c.mu.Unlock()
}

// Connect dials the rosbridge server and maintains the connection until ctx
// is cancelled, reconnecting with exponential backoff (250ms, capped at 4s)
// whenever the connection drops. It returns ctx.Err() when ctx is done.
func (c *Client) Connect(ctx context.Context) error {
	var backoff time.Duration
	for {
		if err := ctx.Err(); err != nil {
			c.setState(Disconnected)
			return err
		}

		c.setState(Connecting)
		conn, _, err := websocket.Dial(ctx, c.url, nil)
		if err != nil {
			c.setState(Disconnected)
			backoff = nextBackoff(backoff)
			if !sleepCtx(ctx, backoff) {
				return ctx.Err()
			}
			continue
		}

		c.mu.Lock()
		c.conn = conn
		c.mu.Unlock()
		c.setState(Connected)
		backoff = 0

		c.resendState()
		c.readLoop(ctx, conn)

		conn.CloseNow()
		c.mu.Lock()
		c.conn = nil
		c.mu.Unlock()
		c.setState(Disconnected)

		if ctx.Err() != nil {
			return ctx.Err()
		}
		backoff = nextBackoff(backoff)
		if !sleepCtx(ctx, backoff) {
			return ctx.Err()
		}
	}
}

// sleepCtx sleeps for d, returning false early (without sleeping the full
// duration) if ctx is cancelled first.
func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-ctx.Done():
		return false
	}
}

// readLoop reads frames until the connection errors or ctx ends, dispatching
// publish frames to any matching subscription.
func (c *Client) readLoop(ctx context.Context, conn *websocket.Conn) {
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var frame inFrame
		if err := json.Unmarshal(data, &frame); err != nil {
			continue
		}
		if frame.Op != "publish" {
			continue
		}
		c.mu.Lock()
		sub, ok := c.subs[frame.Topic]
		c.mu.Unlock()
		if !ok {
			continue
		}
		sub.fn(frame.Msg)
	}
}

// resendState re-sends advertise and subscribe frames for all previously
// registered topics — used on every fresh connect, including reconnects,
// since the rosbridge server has no memory of a prior session.
func (c *Client) resendState() {
	c.mu.Lock()
	ads := make(map[string]string, len(c.advertised))
	for topic, msgType := range c.advertised {
		ads[topic] = msgType
	}
	subs := make(map[string]subscription, len(c.subs))
	for topic, sub := range c.subs {
		subs[topic] = sub
	}
	c.mu.Unlock()

	for topic, msgType := range ads {
		_ = c.writeFrame(advertiseFrame{Op: "advertise", Topic: topic, Type: msgType})
	}
	for topic, sub := range subs {
		_ = c.writeFrame(subscribeFrame{Op: "subscribe", Topic: topic, Type: sub.msgType})
	}
}

// writeFrame marshals v and writes it as a single WebSocket text message on
// the current connection, if any.
func (c *Client) writeFrame(v any) error {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return ErrNotConnected
	}

	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("rosbridge: marshal frame: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageText, b); err != nil {
		return fmt.Errorf("rosbridge: write frame: %w", err)
	}
	return nil
}

// Publish advertises topic (once) and publishes msg on it. msg is marshaled
// as-is into the frame's "msg" field — for std_msgs/String the caller must
// pass an already-stringified payload (e.g. map[string]string{"data": ...}),
// since std_msgs/String has exactly one field and rosbridge does not nest
// arbitrary JSON into it.
func (c *Client) Publish(topic, msgType string, msg any) error {
	c.mu.Lock()
	_, alreadyAdvertised := c.advertised[topic]
	c.advertised[topic] = msgType
	c.mu.Unlock()

	if !alreadyAdvertised {
		if err := c.writeFrame(advertiseFrame{Op: "advertise", Topic: topic, Type: msgType}); err != nil {
			return err
		}
	}
	return c.writeFrame(publishFrame{Op: "publish", Topic: topic, Msg: msg})
}

// Subscribe registers fn to receive the raw "msg" field of every publish
// frame rosbridge sends on topic. The subscription is resent automatically
// on reconnect.
func (c *Client) Subscribe(topic, msgType string, fn func(json.RawMessage)) error {
	c.mu.Lock()
	c.subs[topic] = subscription{msgType: msgType, fn: fn}
	c.mu.Unlock()

	return c.writeFrame(subscribeFrame{Op: "subscribe", Topic: topic, Type: msgType})
}
