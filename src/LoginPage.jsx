import { useState, useEffect, useRef } from "react";
import * as api from "./api/client";

const styles = {};

/* ──────────────────────────────────────────────────────────────────────────────
   GLOBAL KEYFRAMES (injected once)
   ──────────────────────────────────────────────────────────────────────────── */
const keyframes = `
@keyframes loginFadeIn { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
@keyframes loginFadeUp { from { opacity:0; transform:translateY(24px) } to { opacity:1; transform:translateY(0) } }
@keyframes loginScaleIn { from { opacity:0; transform:scale(0.92) } to { opacity:1; transform:scale(1) } }
@keyframes loginShimmer { 0% { background-position:-200% 0 } 100% { background-position:200% 0 } }
@keyframes loginFloat { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-20px) } }
@keyframes loginPulse { 0%,100% { opacity:0.3 } 50% { opacity:0.6 } }
@keyframes loginOrbit { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
@keyframes loginDraw { to { stroke-dashoffset:0 } }
@keyframes loginBreath { 0%,100% { transform:scale(1); opacity:0.5 } 50% { transform:scale(1.05); opacity:0.8 } }
@keyframes loginSlideRight { from { opacity:0; transform:translateX(-20px) } to { opacity:1; transform:translateX(0) } }
@keyframes loginGradientShift { 0% { background-position:0% 50% } 50% { background-position:100% 50% } 100% { background-position:0% 50% } }
@keyframes loginRipple { to { transform:scale(4); opacity:0 } }
@keyframes loginRadarSweep { from { transform:rotate(-45deg) } to { transform:rotate(315deg) } }
@keyframes loginPathDraw { to { stroke-dashoffset:0 } }
@keyframes loginPingDot { 0% { r:2; opacity:1 } 100% { r:12; opacity:0 } }
@keyframes loginPathDraw { to { stroke-dashoffset:0 } }
@keyframes loginSignalBar { 0% { transform:scaleY(0.4) } 50% { transform:scaleY(1) } 100% { transform:scaleY(0.4) } }
@keyframes loginJointOscillate { from { transform:rotate(-25deg) } to { transform:rotate(25deg) } }
@keyframes loginDataPulse { 0%,100% { opacity:0.15; transform:scale(1) } 50% { opacity:0.4; transform:scale(1.15) } }
`;

/* ──────────────────────────────────────────────────────────────────────────────
   STYLE SHEET
   ──────────────────────────────────────────────────────────────────────────── */
const sheet = typeof document !== "undefined" ? (() => {
  const s = document.createElement("style");
  s.textContent = keyframes;
  document.head.appendChild(s);
  return s;
})() : null;

/* ──────────────────────────────────────────────────────────────────────────────
   DECORATIVE ORB COMPONENT
   ──────────────────────────────────────────────────────────────────────────── */
function Orb({ size, x, y, blur, color, delay, duration, float }) {
  return (
    <div style={{
      position: "absolute", width: size, height: size,
      left: x, top: y, borderRadius: "50%",
      background: `radial-gradient(circle at 30% 30%, ${color}, transparent)`,
      filter: `blur(${blur})`,
      opacity: 0.15,
      animation: `loginFloat ${float || 8}s ease-in-out ${delay || 0}s infinite`,
      pointerEvents: "none",
    }} />
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   GRID DOTS
   ──────────────────────────────────────────────────────────────────────────── */
function GridDots() {
  const dots = [];
  for (let row = 0; row < 30; row++) {
    for (let col = 0; col < 40; col++) {
      if (Math.random() > 0.3) continue;
      dots.push({ x: col * 40 + Math.random() * 10, y: row * 40 + Math.random() * 10, size: Math.random() * 2 + 1, delay: Math.random() * 5 });
    }
  }
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {dots.map((d, i) => (
        <div key={i} style={{
          position: "absolute", left: d.x, top: d.y, width: d.size, height: d.size,
          borderRadius: "50%",           background: "rgba(139,162,172,0.2)",
          animation: `loginPulse ${3 + Math.random() * 4}s ease-in-out ${d.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   PROFESSIONAL LiDAR SCAN 360°
   ──────────────────────────────────────────────────────────────────────────── */
function LidarScan() {
  return (
    <div style={{
      position: "absolute", width: 400, height: 400,
      left: "3%", top: "18%",
      pointerEvents: "none", opacity: 0.10,
    }}>
      <svg width="100%" height="100%" viewBox="0 0 400 400">
        <defs>
          <radialGradient id="lidarBeam" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#8BA2AC" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#8BA2AC" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Range rings with tick marks */}
        {[200, 150, 100, 50].map((r) => (
          <g key={r}>
            <circle cx="200" cy="200" r={r} fill="none" stroke="#8BA2AC" strokeWidth="0.35" opacity={0.12} />
            {Array.from({ length: 24 }).map((_, j) => {
              const a = j * 15 * Math.PI / 180;
              const inner = r - 3;
              const outer = r + 3;
              return (
                <line key={j}
                  x1={200 + inner * Math.cos(a)} y1={200 + inner * Math.sin(a)}
                  x2={200 + outer * Math.cos(a)} y2={200 + outer * Math.sin(a)}
                  stroke="#8BA2AC" strokeWidth={j % 6 === 0 ? 0.6 : 0.3} opacity={0.15} />
              );
            })}
          </g>
        ))}
        {/* Crosshairs */}
        <line x1="200" y1="8" x2="200" y2="392" stroke="#8BA2AC" strokeWidth="0.25" opacity="0.06" />
        <line x1="8" y1="200" x2="392" y2="200" stroke="#8BA2AC" strokeWidth="0.25" opacity="0.06" />
        {/* Sweep arm */}
        <g style={{ transformOrigin: "200px 200px", animation: "loginRadarSweep 6s linear infinite" }}>
          <path d="M200 200 L200 15 A185 185 0 0 1 385 200 Z" fill="url(#lidarBeam)" />
          <line x1="200" y1="200" x2="200" y2="15" stroke="#8BA2AC" strokeWidth="0.8" opacity={0.35} />
          {/* Detection pings */}
          {[
            { cy: 45, dur: 0.8 }, { cy: 85, dur: 1.3 },
            { cy: 125, dur: 1.0 }, { cy: 165, dur: 1.6 },
          ].map((p, i) => (
            <circle key={i} cx="200" cy={p.cy} r="1.5" fill="#A0B4BE">
              <animate attributeName="opacity" values="0;0.8;0" dur={`${p.dur}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </g>
      </svg>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   ROBOT PATH / TRAJECTORY PLANNER
   ──────────────────────────────────────────────────────────────────────────── */
function PathTrajectory() {
  const waypoints = [
    { x: 20, y: 90 }, { x: 55, y: 50 }, { x: 90, y: 65 },
    { x: 125, y: 35 }, { x: 160, y: 55 }, { x: 195, y: 30 },
    { x: 230, y: 60 }, { x: 265, y: 40 }, { x: 300, y: 70 },
  ];
  const pathD = waypoints.map((p, i) =>
    i === 0 ? `M${p.x} ${p.y}` : `Q${(waypoints[i-1].x + p.x) / 2} ${(waypoints[i-1].y + p.y) / 2 - 15} ${p.x} ${p.y}`
  ).join(" ");
  return (
    <div style={{
      position: "absolute", right: "4%", bottom: "22%",
      width: 340, height: 130,
      pointerEvents: "none", opacity: 0.09,
    }}>
      <svg width="100%" height="100%" viewBox="0 0 320 120" fill="none">
        {/* Full path (always visible) */}
        <path d={pathD} stroke="#8BA2AC" strokeWidth="0.8" opacity="0.2" />
        {/* Animated drawing path */}
        <path d={pathD} stroke="#8BA2AC" strokeWidth="1.2" strokeLinecap="round"
          strokeDasharray="600" strokeDashoffset="600"
          style={{ animation: "loginPathDraw 3.5s ease-in-out infinite alternate" }} />
        {/* Waypoint nodes */}
        {waypoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2" fill="none" stroke="#8BA2AC" strokeWidth="0.6" opacity={0.25} />
        ))}
        {/* Traveling dot */}
        <circle r="3" fill="#A0B4BE" opacity="0.6">
          <animateMotion dur="4s" repeatCount="indefinite" rotate="auto">
            <mpath href="#trajectoryPath" />
          </animateMotion>
        </circle>
        {/* Hidden path reference for animateMotion */}
        <path id="trajectoryPath" d={pathD} fill="none" stroke="none" />
      </svg>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   ROBOT TELEMETRY HUD
   ──────────────────────────────────────────────────────────────────────────── */
function TelemetryHUD() {
  return (
    <div style={{
      position: "absolute", right: "8%", top: "15%",
      pointerEvents: "none", opacity: 0.09,
    }}>
      <svg width="70" height="70" viewBox="0 0 70 70" fill="none">
        {/* Signal bars */}
        {[8, 14, 20, 28].map((h, i) => (
          <rect key={i} x={i * 14} y={50 - h} width="10" height={h} rx="2" fill="#8BA2AC" opacity="0.35">
            <animate attributeName="height" values={`${h};${h + 6};${h}`} dur={`${1.5 + i * 0.25}s`} repeatCount="indefinite" />
            <animate attributeName="y" values={`${50 - h};${50 - h - 6};${50 - h}`} dur={`${1.5 + i * 0.25}s`} repeatCount="indefinite" />
          </rect>
        ))}
        {/* Status dot */}
        <circle cx="42" cy="12" r="4" fill="#8BA2AC" opacity="0.5">
          <animate attributeName="opacity" values="0.15;0.6;0.15" dur="2s" repeatCount="indefinite" />
          <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite" />
        </circle>
        {/* Label */}
        <text x="0" y="68" fill="#8BA2AC" fontSize="4.5" opacity="0.2" fontFamily="'SF Mono', 'Fira Code', monospace" letterSpacing="0.2em">SYS ONLINE</text>
      </svg>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   MECHANICAL JOINT / ACTUATOR
   ──────────────────────────────────────────────────────────────────────────── */
function MechanicalJoint() {
  return (
    <div style={{
      position: "absolute", left: "38%", bottom: "10%",
      pointerEvents: "none", opacity: 0.07,
    }}>
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        {/* Base plate */}
        <rect x="14" y="48" width="36" height="12" rx="2" fill="#8BA2AC" opacity="0.25" />
        {/* Bolts */}
        {[[18, 54], [42, 54]].map(([bx, by]) => (
          <circle key={bx} cx={bx} cy={by} r="2" fill="#8BA2AC" opacity="0.15" />
        ))}
        {/* Lower arm (oscillating) */}
        <g style={{ transformOrigin: "32px 48px", animation: "loginJointOscillate 5s ease-in-out infinite alternate" }}>
          <rect x="28" y="20" width="8" height="30" rx="2" fill="#8BA2AC" opacity="0.3" />
          {/* Joint circle */}
          <circle cx="32" cy="48" r="7" fill="none" stroke="#8BA2AC" strokeWidth="1.2" opacity="0.4" />
          {/* Upper arm (counter-oscillating) */}
          <g style={{ transformOrigin: "32px 24px", animation: "loginJointOscillate 4s ease-in-out infinite alternate-reverse" }}>
            <rect x="28" y="6" width="8" height="18" rx="2" fill="#8BA2AC" opacity="0.25" />
            {/* Upper joint */}
            <circle cx="32" cy="24" r="5" fill="none" stroke="#8BA2AC" strokeWidth="1" opacity="0.3" />
            {/* End-effector */}
            <rect x="26" y="2" width="12" height="5" rx="1.5" fill="#8BA2AC" opacity="0.2" />
          </g>
        </g>
        {/* Axle pin */}
        <circle cx="32" cy="48" r="3" fill="#A0B4BE" opacity="0.4" />
        <circle cx="32" cy="48" r="1.5" fill="#FFFFFF" opacity="0.1" />
      </svg>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
   ──────────────────────────────────────────────────────────────────────────── */
export default function LoginPage({ onLogin, onSwitchToSignup }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const emailRef = useRef(null);

  useEffect(() => { setLoaded(true); emailRef.current?.focus(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) { setError("Enter your email address"); return; }
    if (!password) { setError("Enter your password"); return; }
    setLoading(true);
    try {
      await api.login(email.trim(), password);
      onLogin();
    } catch (err) {
      // The daemon returns the same message whether the address is unknown or
      // the password is wrong — show it as-is rather than guessing which.
      setError(err.message);
      setLoading(false);
    }
  };

  const inputBase = {
    width: "100%", padding: "14px 16px", fontSize: 14,
    background: "rgba(255,255,255,0.06)",
    border: "1.5px solid rgba(255,255,255,0.10)",
    borderRadius: 12,
    color: "#fff",
    fontFamily: "'Inter', -apple-system, sans-serif",
    outline: "none",
    boxSizing: "border-box",
    transition: "all 0.3s cubic-bezier(0.16,1,0.3,1)",
    letterSpacing: "0.01em",
  };

  const inputFocus = {
    borderColor: "rgba(139,162,172,0.5)",
    background: "rgba(255,255,255,0.08)",
    boxShadow: "0 0 0 4px rgba(139,162,172,0.10), 0 2px 12px rgba(0,0,0,0.12)",
  };

  return (
    <div style={{
      minHeight: "100vh", width: "100vw",
      background: "#1e1e1e",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color: "#fff",
      position: "relative",
      overflow: "hidden",
      display: "flex",
    }}>
      {/* ── Subtle brand gradient overlay ── */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 80% 60% at 50% -20%, rgba(139,162,172,0.10), transparent), radial-gradient(ellipse 60% 50% at 80% 80%, rgba(74,74,74,0.08), transparent)",
        animation: "loginGradientShift 25s ease-in-out infinite",
        backgroundSize: "200% 200%",
      }} />

      {/* ── Orbs ── */}
      <Orb size={500} x="-15%" y="-10%" blur="100px" color="#8BA2AC" delay={0} float={12} />
      <Orb size={350} x="75%" y="40%" blur="80px" color="#475569" delay={3} float={10} />
      <Orb size={250} x="40%" y="80%" blur="70px" color="#4A4A4A" delay={5} float={9} />

      {/* ── Grid dots ── */}
      <GridDots />

      {/* ── Grid mesh ── */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: 0.03 }}>
        <defs>
          <pattern id="loginGrid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#fff" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#loginGrid)" />
      </svg>

      {/* ── Glow line accent ── */}
      <div style={{
        position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
        width: "40%", height: 1,
        background: "linear-gradient(90deg, transparent, rgba(139,162,172,0.4), rgba(74,74,74,0.4), transparent)",
      }} />

      {/* ── AMR Hardware Decorations ── */}
      <LidarScan />
      <PathTrajectory />
      <TelemetryHUD />
      <MechanicalJoint />

      {/* ── CONTENT ── */}
      <div style={{
        position: "relative", zIndex: 1,
        display: "flex", width: "100%", maxWidth: 1280,
        margin: "0 auto", padding: "40px 48px",
        alignItems: "center", gap: 80,
        opacity: loaded ? 1 : 0,
        transform: loaded ? "translateY(0)" : "translateY(12px)",
        transition: "all 0.8s cubic-bezier(0.16,1,0.3,1)",
      }}>
        {/* ═══════════════════════════ L E F T ═══════════════════════════ */}
        <div style={{
          flex: 1, maxWidth: 500,
          animation: loaded ? "loginFadeUp 1s cubic-bezier(0.16,1,0.3,1) forwards" : "none",
        }}>
          <div style={{
            fontSize: 15, color: "#8BA2AC", fontWeight: 700,
            letterSpacing: "0.15em", marginBottom: 16, textTransform: "uppercase",
          }}>
            Welcome to
          </div>

          <h1 style={{
            fontSize: 40, fontWeight: 700, lineHeight: 1.15, margin: 0, marginBottom: 10,
            letterSpacing: "-0.03em",
          }}>
            <span style={{ color: "#4A4A4A" }}>Corelyn</span>{" "}
            <span style={{ color: "#8BA2AC" }}>Robotics</span>
          </h1>

          <div style={{
            fontSize: 16, fontWeight: 500, color: "rgba(255,255,255,0.5)",
            marginBottom: 28, letterSpacing: "-0.01em",
          }}>
            Smarter Routes, Stronger Fleets
          </div>

          <p style={{
            fontSize: 14, color: "rgba(255,255,255,0.35)", lineHeight: 1.7,
            margin: 0, marginBottom: 36, maxWidth: 420,
          }}>
            Enterprise fleet management platform for autonomous mobile robots. Design, deploy, and monitor multi-AGV workflows with our visual programming canvas.
          </p>

          {/* Feature list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { text: "Visual workflow builder with 20+ robot command blocks" },
              { text: "Real-time AMR telemetry and battery monitoring" },
              { text: "Tap-to-connect node routing for rapid mission design" },
              { text: "Live mission execution with status tracking and logs" },
            ].map((item, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 14,
                animation: loaded ? `loginSlideRight 0.6s cubic-bezier(0.16,1,0.3,1) ${0.3 + i * 0.1}s both` : "none",
              }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
                  <circle cx="10" cy="10" r="9" stroke="rgba(139,92,246,0.3)" strokeWidth="1.5" fill="rgba(139,92,246,0.06)" />
                  <path d="M6 10.5L9 13.5L14 7" stroke="rgba(139,92,246,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.4 }}>{item.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ═══════════════════════════ R I G H T ═══════════════════════════ */}
        <div style={{
          width: 400, flexShrink: 0,
          animation: loaded ? "loginFadeUp 0.8s cubic-bezier(0.16,1,0.3,1) 0.15s both" : "none",
        }}>
          {/* Glass card */}
          <div style={{
            background: "rgba(255,255,255,0.03)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 20,
            padding: "40px 36px 36px",
            boxShadow: "0 24px 80px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
            position: "relative",
            overflow: "hidden",
          }}>
            {/* Inner glow */}
            <div style={{
              position: "absolute", top: -100, right: -100, width: 200, height: 200,
              background: "radial-gradient(circle, rgba(139,162,172,0.06), transparent)",
              borderRadius: "50%", pointerEvents: "none",
            }} />

            {/* Header */}
            <div style={{ marginBottom: 28, position: "relative" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 6, letterSpacing: "-0.02em" }}>Welcome back</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>Sign in to your account to continue.</div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} style={{ position: "relative" }}>
              {/* Email */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 600, display: "block", marginBottom: 7, letterSpacing: "0.05em" }}>EMAIL</label>
                <input
                  ref={emailRef}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  disabled={loading}
                  onFocus={() => setFocused("email")}
                  onBlur={() => setFocused(null)}
                  style={{
                    ...inputBase,
                    borderColor: focused === "email" ? "rgba(139,162,172,0.5)" : "rgba(255,255,255,0.08)",
                    background: focused === "email" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                    boxShadow: focused === "email" ? "0 0 0 4px rgba(139,162,172,0.08), 0 2px 12px rgba(0,0,0,0.1)" : "0 2px 8px rgba(0,0,0,0.06)",
                    opacity: loading ? 0.5 : 1,
                    cursor: loading ? "not-allowed" : "text",
                  }}
                />
              </div>

              {/* Password */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 600, display: "block", marginBottom: 7, letterSpacing: "0.05em" }}>PASSWORD</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  disabled={loading}
                  onFocus={() => setFocused("password")}
                  onBlur={() => setFocused(null)}
                  style={{
                    ...inputBase,
                    borderColor: focused === "password" ? "rgba(139,162,172,0.5)" : "rgba(255,255,255,0.08)",
                    background: focused === "password" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                    boxShadow: focused === "password" ? "0 0 0 4px rgba(139,162,172,0.08), 0 2px 12px rgba(0,0,0,0.1)" : "0 2px 8px rgba(0,0,0,0.06)",
                    opacity: loading ? 0.5 : 1,
                    cursor: loading ? "not-allowed" : "text",
                  }}
                />
              </div>

              {/* Error */}
              {error && (
                <div style={{
                  fontSize: 12, color: "#f87171", marginBottom: 20,
                  padding: "10px 14px",
                  background: "rgba(248,113,113,0.06)",
                  borderRadius: 10,
                  border: "1px solid rgba(248,113,113,0.12)",
                  lineHeight: 1.4,
                  animation: "loginFadeIn 0.3s ease",
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                    <circle cx="8" cy="8" r="7" stroke="#f87171" strokeWidth="1.5" fill="rgba(248,113,113,0.08)" />
                    <path d="M8 5V9" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="8" cy="11" r="0.8" fill="#f87171" />
                  </svg>
                  {error}
                </div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%", padding: "14px 0", border: "none", borderRadius: 12,
                  background: loading ? "rgba(139,162,172,0.3)" : "#8BA2AC",
                  color: "#1e1e1e", fontSize: 14, fontWeight: 700,
                  cursor: loading ? "not-allowed" : "pointer",
                  fontFamily: "'Inter', sans-serif",
                  transition: "all 0.3s cubic-bezier(0.16,1,0.3,1)",
                  boxShadow: loading ? "none" : "0 4px 20px rgba(139,162,172,0.25), 0 2px 8px rgba(139,162,172,0.15)",
                  position: "relative",
                  overflow: "hidden",
                  letterSpacing: "0.01em",
                }}
                onMouseEnter={e => {
                  if (!loading) {
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow = "0 6px 28px rgba(139,162,172,0.35), 0 2px 10px rgba(139,162,172,0.2)";
                    e.currentTarget.style.background = "#7A929C";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = loading ? "none" : "0 4px 20px rgba(139,162,172,0.25), 0 2px 8px rgba(139,162,172,0.15)";
                  e.currentTarget.style.background = "#8BA2AC";
                }}
              >
                {/* Shimmer overlay */}
                {loading && (
                  <div style={{
                    position: "absolute", inset: 0,
                    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
                    backgroundSize: "200% 100%",
                    animation: "loginShimmer 1.5s ease-in-out infinite",
                  }} />
                )}

                <span style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  opacity: loading ? 0.7 : 1,
                }}>
                  {/* Structurally stable across the loading flip: the label is
                      always a text node and only the spinner appears and
                      disappears. Toggling between a fragment of two children
                      and a bare string gave React Fast Refresh a tree it could
                      not reconcile, and removing the spinner threw
                      NotFoundError: removeChild. */}
                  {loading && (
                    <svg key="spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ animation: "loginOrbit 0.8s linear infinite" }}>
                      <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" fill="none" />
                      <path d="M12 2A10 10 0 0 1 22 12" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                    </svg>
                  )}
                  {loading ? "Signing in…" : "Sign In"}
                </span>
              </button>
            </form>

              {/* ── Social divider ── */}
              <div style={{
                display: "flex", alignItems: "center", gap: 16, margin: "20px 0 18px",
              }}>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", fontWeight: 500, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>or continue with</span>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
              </div>

              {/* ── Social buttons ── */}
              <div style={{ display: "flex", gap: 12, marginBottom: 22 }}>
                {[
                  {
                    label: "Google",
                    icon: <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg>,
                  },
                  {
                    label: "LinkedIn",
                    icon: <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#0A66C2" d="M22.23 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.46c.98 0 1.77-.77 1.77-1.72V1.72C24 .77 23.21 0 22.23 0zM7.12 20.45H3.56V9.03h3.56v11.42zM5.34 7.53a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zm15.11 12.92h-3.56v-6.17c0-1.47-.03-3.36-2.05-3.36-2.05 0-2.36 1.6-2.36 3.25v6.28H8.92V9.03h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.25z"/></svg>,
                  },
                ].map((btn) => (
                  <button key={btn.label} type="button"
                    style={{
                      flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      padding: "11px 0",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 10,
                      color: "rgba(255,255,255,0.6)",
                      fontSize: 12, fontWeight: 600,
                      fontFamily: "'Inter', sans-serif",
                      cursor: "pointer",
                      transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)",
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                      e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
                      e.currentTarget.style.color = "#fff";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                      e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                      e.currentTarget.style.color = "rgba(255,255,255,0.6)";
                    }}
                  >
                    {btn.icon}
                    {btn.label}
                  </button>
                ))}
              </div>

              {/* ── Sign up link ── */}
              <div style={{
                textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.25)",
              }}>
                Don't have an account?{" "}
                <span
                  onClick={onSwitchToSignup}
                  style={{
                    color: "#8BA2AC", fontWeight: 600, cursor: "pointer",
                    transition: "color 0.2s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = "#A0B4BE"}
                  onMouseLeave={e => e.currentTarget.style.color = "#8BA2AC"}
                >Sign up</span>
              </div>
          </div>

          {/* Trust indicators */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 24,
            marginTop: 24, opacity: 0.2,
            animation: loaded ? "loginFadeIn 0.8s ease 0.6s both" : "none",
          }}>
            {["SOC 2", "GDPR", "256-bit", "99.9%"].map((label, i) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6L5 9L10 3" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.04em", fontWeight: 500 }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        height: 48,
        borderTop: "1px solid rgba(255,255,255,0.04)",
        background: "rgba(0,0,0,0.2)",
        zIndex: 2,
      }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", letterSpacing: "0.03em" }}>
          © {new Date().getFullYear()} Corelyn Robotics. All rights reserved.
        </span>
      </div>
    </div>
  );
}
