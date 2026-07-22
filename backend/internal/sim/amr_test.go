package sim

import (
	"math"
	"testing"
	"time"
)

func almostEqual(a, b float64) bool {
	return math.Abs(a-b) < 1e-6
}

func TestAMRMoveKinematics(t *testing.T) {
	cases := []struct {
		name         string
		distanceM    float64
		velocityMS   float64
		wantX        float64
		wantDuration time.Duration
	}{
		{"1m at 0.5m/s", 1.0, 0.5, 1.0, 2 * time.Second},
		{"2m at 1m/s", 2.0, 1.0, 2.0, 2 * time.Second},
		{"reverse 1m at 0.5m/s", -1.0, 0.5, -1.0, 2 * time.Second},
		{"zero distance", 0, 1.0, 0, 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := NewAMR()
			gotDuration := a.Move(tc.distanceM, tc.velocityMS)
			x, _, _ := a.Pose()
			if !almostEqual(x, tc.wantX) {
				t.Errorf("x = %v, want %v", x, tc.wantX)
			}
			if gotDuration != tc.wantDuration {
				t.Errorf("duration = %v, want %v", gotDuration, tc.wantDuration)
			}
		})
	}
}

func TestAMRMoveDrainsBattery(t *testing.T) {
	a := NewAMR()
	if a.Battery() != 100 {
		t.Fatalf("initial battery = %v, want 100", a.Battery())
	}
	a.Move(10, 1.0)
	if !(a.Battery() < 100) {
		t.Errorf("battery after move = %v, want < 100", a.Battery())
	}
}

func TestAMRBatteryClampsAtZero(t *testing.T) {
	a := NewAMR()
	a.SetBattery(1)
	a.Move(1000, 1.0)
	if a.Battery() != 0 {
		t.Errorf("battery = %v, want clamped to 0", a.Battery())
	}
}

func TestAMRSetBattery(t *testing.T) {
	a := NewAMR()
	a.SetBattery(42)
	if a.Battery() != 42 {
		t.Errorf("battery = %v, want 42", a.Battery())
	}
}

func TestFaultsClear(t *testing.T) {
	f := &Faults{}
	f.SetEstop(true)
	f.SetNodeError("n1")
	f.SetStalled(true)

	f.Clear()

	if f.Estopped() {
		t.Error("Estopped() = true after Clear")
	}
	if f.Stalled() {
		t.Error("Stalled() = true after Clear")
	}
	if f.NodeErrorFor("n1") {
		t.Error("NodeErrorFor() = true after Clear")
	}
}

func TestFaultsNodeErrorIsOneShot(t *testing.T) {
	f := &Faults{}
	f.SetNodeError("n1")

	if !f.NodeErrorFor("n1") {
		t.Fatal("NodeErrorFor(n1) = false, want true on first check")
	}
	if f.NodeErrorFor("n1") {
		t.Error("NodeErrorFor(n1) = true on second check, want one-shot")
	}
}

func TestFaultsNodeErrorOnlyMatchesArmedNode(t *testing.T) {
	f := &Faults{}
	f.SetNodeError("n1")

	if f.NodeErrorFor("n2") {
		t.Error("NodeErrorFor(n2) = true, want false for a different node id")
	}
}
