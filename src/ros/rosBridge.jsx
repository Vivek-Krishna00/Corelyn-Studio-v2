import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import * as ROSLIB from "roslib";

const ROS_URL = import.meta.env.VITE_ROSBRIDGE_URL || "";

const ROSContext = createContext(null);

export function ROSProvider({ url = ROS_URL, reconnectInterval = 3000, children }) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("disconnected");
  const rosRef = useRef(null);
  const reconnectTimer = useRef(null);
  const connectFnRef = useRef(null);

  useEffect(() => {
    if (!url) { setStatus("unavailable"); return; }
    connectFnRef.current = () => {
      if (rosRef.current) {
        try { rosRef.current.close(); } catch (_) {}
      }
      setStatus("connecting");
      try {
        const ros = new ROSLIB.Ros({ url });
        rosRef.current = ros;

        ros.on("connection", () => {
          setConnected(true);
          setStatus("connected");
          clearTimeout(reconnectTimer.current);
        });

        ros.on("close", () => {
          setConnected(false);
          setStatus("disconnected");
          scheduleReconnect();
        });

        ros.on("error", () => {
          setConnected(false);
          setStatus("error");
          scheduleReconnect();
        });
      } catch (e) {
        setStatus("error");
        scheduleReconnect();
      }
    };
  });

  const scheduleReconnect = useCallback(() => {
    clearTimeout(reconnectTimer.current);
    reconnectTimer.current = setTimeout(() => {
      setStatus("reconnecting");
      if (connectFnRef.current) connectFnRef.current();
    }, reconnectInterval);
  }, [reconnectInterval]);

  const connect = useCallback(() => {
    if (connectFnRef.current) connectFnRef.current();
  }, []);

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimer.current);
    if (rosRef.current) {
      try { rosRef.current.close(); } catch (_) {}
      rosRef.current = null;
    }
    setConnected(false);
    setStatus("disconnected");
  }, []);

  const deployMission = useCallback((missionSpec) => {
    if (!rosRef.current || !connected) {
      throw new Error("ROS not connected");
    }
    const topic = new ROSLIB.Topic({
      ros: rosRef.current,
      name: "/mission/deploy",
      messageType: "std_msgs/String",
    });
    topic.publish({ data: JSON.stringify(missionSpec) });
  }, [connected]);

  const subscribeStatus = useCallback((callback) => {
    if (!rosRef.current || !connected) {
      return () => {};
    }
    const topic = new ROSLIB.Topic({
      ros: rosRef.current,
      name: "/mission/status",
      messageType: "std_msgs/String",
    });
    topic.subscribe((msg) => {
      try {
        const data = JSON.parse(msg.data);
        callback(data);
      } catch (_) {}
    });
    return () => topic.unsubscribe();
  }, [connected]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (rosRef.current) {
        try { rosRef.current.close(); } catch (_) {}
      }
    };
  }, [connect]);

  const value = { connected, status, connect, disconnect, deployMission, subscribeStatus, ros: rosRef };

  return <ROSContext.Provider value={value}>{children}</ROSContext.Provider>;
}

export function useROS() {
  const ctx = useContext(ROSContext);
  if (!ctx) throw new Error("useROS must be used within ROSProvider");
  return ctx;
}

export function useMissionStatus(handler) {
  const { connected, subscribeStatus } = useROS();
  useEffect(() => {
    if (!connected || !handler) return;
    const unsub = subscribeStatus(handler);
    return unsub;
  }, [connected, handler, subscribeStatus]);
}
