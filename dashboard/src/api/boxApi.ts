export type BoxStatusResponse = {
  success: boolean;
  data?: {
    sensors?: {
      air_temp_c?: number;
      air_humidity_pct?: number;
      soil_temp_c?: number;
      soil_moisture_raw?: number;
      light_raw?: number;
    };
    actuators?: {
      pump?: 0 | 1;
      fan?: 0 | 1;
      heater?: 0 | 1;
      lamp?: 0 | 1;
    };
    automation_mode?: boolean;
  };
  error?: string;
};

async function safeJson(res: Response) {
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
  if (!ct.includes('application/json')) throw new Error(`Expected JSON, got ${ct}: ${text.slice(0, 60)}`);
  return JSON.parse(text);
}

export async function fetchBoxStatus(): Promise<BoxStatusResponse> {
  const res = await fetch('/box/api/status');
  return safeJson(res);
}

export async function setActuator(
  actuator: 'pump' | 'fan' | 'heater' | 'lamp',
  state: 0 | 1
): Promise<BoxStatusResponse> {
  const res = await fetch(`/box/api/actuator/${actuator}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  return safeJson(res);
}

export async function setAutomation(enabled: boolean): Promise<BoxStatusResponse> {
  const res = await fetch('/box/api/automation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  return safeJson(res);
}
