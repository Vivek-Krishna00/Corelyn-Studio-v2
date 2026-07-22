// Package sim is the AMR kinematics and battery model used only by
// cmd/corelyn-mockbot. It must never be imported by the daemon — simulation
// code has no business running against a real robot.
package sim

import (
	"math"
	"sync"
	"time"
)

// AMR is a minimal kinematic + battery model: not a physics engine, just
// enough to make status/telemetry plausible without hardware. Motion is a
// straight-line integration along the current heading.
type AMR struct {
	mu         sync.Mutex
	x, y       float64
	thetaRad   float64
	batteryPct float64
	speedMS    float64
}

// NewAMR returns an AMR at the origin with a full battery.
func NewAMR() *AMR {
	return &AMR{batteryPct: 100}
}

// Move integrates a straight-line motion of distanceM meters (negative for
// reverse) at linearVelocityMS along the current heading and returns how
// long it takes. A non-positive velocity is treated as a slow crawl rather
// than dividing by zero — bad params shouldn't hang the mission forever.
func (a *AMR) Move(distanceM, linearVelocityMS float64) time.Duration {
	a.mu.Lock()
	defer a.mu.Unlock()

	if linearVelocityMS <= 0 {
		linearVelocityMS = 0.1
	}

	a.speedMS = linearVelocityMS
	a.x += distanceM * math.Cos(a.thetaRad)
	a.y += distanceM * math.Sin(a.thetaRad)
	a.drainLocked(math.Abs(distanceM))
	a.speedMS = 0

	seconds := math.Abs(distanceM) / linearVelocityMS
	return time.Duration(seconds * float64(time.Second))
}

// drainLocked lowers the battery by a made-up but stable rate of 1% per
// meter travelled, clamped at 0.
//
// ponytail: not a real discharge curve, just enough for plausible telemetry.
// Replace with a measured curve when real battery data exists.
func (a *AMR) drainLocked(distanceM float64) {
	a.batteryPct -= distanceM
	if a.batteryPct < 0 {
		a.batteryPct = 0
	}
}

// SetBattery forces the battery level, used by the "battery" fault.
func (a *AMR) SetBattery(pct float64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.batteryPct = pct
}

// Battery reports the current battery percentage.
func (a *AMR) Battery() float64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.batteryPct
}

// Speed reports the current linear speed in m/s (0 when not moving).
func (a *AMR) Speed() float64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.speedMS
}

// Pose returns the current x, y, theta (radians).
func (a *AMR) Pose() (x, y, thetaRad float64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.x, a.y, a.thetaRad
}
