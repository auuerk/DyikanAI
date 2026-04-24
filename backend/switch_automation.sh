#!/bin/bash
# =============================================================================
# switch_automation.sh  —  AgriControl
# =============================================================================
# Safely switches between the threshold-based automation engine (v2) and the
# Mamdani FLC engine (v3). Guarantees only one engine runs at a time.
#
# Usage:
#   ./switch_automation.sh threshold   — start v2, stop FLC
#   ./switch_automation.sh flc         — start FLC, stop v2
#   ./switch_automation.sh status      — show which engine is active
#   ./switch_automation.sh stop        — stop both engines
#
# Must be run as a user with sudo access (sguser has this on smartgreenhouse).
# =============================================================================

SERVICE_THRESHOLD="agricontrol-automation"
SERVICE_FLC="agricontrol-automation-flc"
LOG_THRESHOLD="/home/sguser/iot-backend/auto.log"
LOG_FLC="/home/sguser/iot-backend/auto_flc.log"

# ── Helpers ───────────────────────────────────────────────────────────────────
is_active() {
    systemctl is-active --quiet "$1"
}

print_status() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo " AgriControl — Automation Engine Status"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if is_active "$SERVICE_THRESHOLD"; then
        echo "  Threshold engine (v2) : RUNNING"
    else
        echo "  Threshold engine (v2) : stopped"
    fi

    if is_active "$SERVICE_FLC"; then
        echo "  FLC engine (v3)       : RUNNING"
    else
        echo "  FLC engine (v3)       : stopped"
    fi
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

stop_both() {
    echo "[SWITCH] Stopping both automation engines..."
    sudo systemctl stop "$SERVICE_THRESHOLD" 2>/dev/null
    sudo systemctl stop "$SERVICE_FLC" 2>/dev/null
    sleep 2

    # Verify neither is running
    if is_active "$SERVICE_THRESHOLD" || is_active "$SERVICE_FLC"; then
        echo "[ERROR] Failed to stop one or both engines. Check systemctl status."
        exit 1
    fi
    echo "[SWITCH] Both engines stopped."
}

# ── Main ──────────────────────────────────────────────────────────────────────
case "$1" in

    threshold)
        echo ""
        echo "[SWITCH] Switching to threshold automation engine (v2)..."
        stop_both
        sudo systemctl start "$SERVICE_THRESHOLD"
        sleep 3
        if is_active "$SERVICE_THRESHOLD"; then
            echo "[SWITCH] Threshold engine (v2) is now RUNNING."
            echo "[SWITCH] Log: $LOG_THRESHOLD"
            echo "[SWITCH] To watch: tail -f $LOG_THRESHOLD"
        else
            echo "[ERROR] Threshold engine failed to start. Check:"
            echo "  sudo systemctl status $SERVICE_THRESHOLD"
            echo "  tail -20 $LOG_THRESHOLD"
            exit 1
        fi
        print_status
        ;;

    flc)
        echo ""
        echo "[SWITCH] Switching to FLC automation engine (v3)..."
        stop_both
        sudo systemctl start "$SERVICE_FLC"
        sleep 3
        if is_active "$SERVICE_FLC"; then
            echo "[SWITCH] FLC engine (v3) is now RUNNING."
            echo "[SWITCH] Log: $LOG_FLC"
            echo "[SWITCH] To watch: tail -f $LOG_FLC"
        else
            echo "[ERROR] FLC engine failed to start. Check:"
            echo "  sudo systemctl status $SERVICE_FLC"
            echo "  tail -20 $LOG_FLC"
            exit 1
        fi
        print_status
        ;;

    stop)
        stop_both
        print_status
        ;;

    status)
        print_status
        ;;

    *)
        echo ""
        echo "Usage: $0 {threshold|flc|status|stop}"
        echo ""
        echo "  threshold  — run threshold-based engine (v2), stop FLC"
        echo "  flc        — run Mamdani FLC engine (v3), stop threshold"
        echo "  stop       — stop both engines"
        echo "  status     — show which engine is currently active"
        echo ""
        exit 1
        ;;
esac
