import React, { useEffect, useRef, useState } from 'react';
import { Slider, Typography, theme as antTheme } from 'antd';

type Rotation = { yaw: number; pitch: number };
type MovementAimProps = Rotation & { onAim: (rotation: Rotation) => void };
const toDegrees = (radians: number) => Math.round((radians * 180) / Math.PI);
const normalizeYaw = (degrees: number) => ((degrees % 360) + 360) % 360;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const pitchLabel = (degrees: number) => {
  if (degrees === 0) return 'level';
  return degrees < 0 ? 'up' : 'down';
};
const compass = [
  'North',
  'Northeast',
  'East',
  'Southeast',
  'South',
  'Southwest',
  'West',
  'Northwest',
];

function MovementAim({ yaw, pitch, onAim }: MovementAimProps) {
  const { token } = antTheme.useToken();
  const [draft, setDraft] = useState({
    yaw: normalizeYaw(Math.round((-yaw * 180) / Math.PI)),
    pitch: toDegrees(-pitch),
  });
  const draftRef = useRef(draft);
  const dragging = useRef(false);
  const lastSent = useRef(0);
  const lastSentRotation = useRef<typeof draft | null>(null);
  const dialRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dragging.current) {
      const next = {
        yaw: normalizeYaw(Math.round((-yaw * 180) / Math.PI)),
        pitch: toDegrees(-pitch),
      };
      draftRef.current = next;
      setDraft(next);
    }
  }, [yaw, pitch]);

  const send = (next: typeof draft, force = false) => {
    if (
      lastSentRotation.current?.yaw === next.yaw &&
      lastSentRotation.current?.pitch === next.pitch
    )
      return;
    const now = Date.now();
    if (!force && now - lastSent.current < 100) return;
    lastSent.current = now;
    lastSentRotation.current = next;
    onAim({ yaw: -toRadians(next.yaw), pitch: -toRadians(next.pitch) });
  };
  const change = (next: typeof draft, force = false) => {
    draftRef.current = next;
    setDraft(next);
    send(next, force);
  };
  const aimAtPointer = (clientX: number, clientY: number, force = false) => {
    const rect = dialRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = clientX - rect.left - rect.width / 2;
    const dy = clientY - rect.top - rect.height / 2;
    if (Math.hypot(dx, dy) < 12) return;
    change(
      {
        ...draftRef.current,
        yaw: normalizeYaw(Math.round((Math.atan2(dx, -dy) * 180) / Math.PI)),
      },
      force,
    );
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 1 : 5;
    let delta = 0;
    if (event.key === 'ArrowRight') delta = step;
    if (event.key === 'ArrowLeft') delta = -step;
    if (!delta) return;
    event.preventDefault();
    change(
      { ...draftRef.current, yaw: normalizeYaw(draftRef.current.yaw + delta) },
      true,
    );
  };
  const angle = toRadians(draft.yaw);
  const markerX = 50 + Math.sin(angle) * 30;
  const markerY = 50 - Math.cos(angle) * 30;
  const facing = compass[Math.round(draft.yaw / 45) % compass.length];

  return (
    <section aria-labelledby="aim-heading">
      <Typography.Title
        id="aim-heading"
        level={4}
        style={{ marginTop: 0, marginBottom: 4 }}
      >
        Look
      </Typography.Title>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: 24,
          marginTop: 20,
        }}
      >
        <div
          ref={dialRef}
          role="slider"
          tabIndex={0}
          aria-label="Head direction"
          aria-valuemin={0}
          aria-valuemax={359}
          aria-valuenow={draft.yaw}
          aria-valuetext={`${draft.yaw} degrees, clockwise from north`}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragging.current = true;
            aimAtPointer(event.clientX, event.clientY);
          }}
          onPointerMove={(event) => {
            if (dragging.current) aimAtPointer(event.clientX, event.clientY);
          }}
          onPointerUp={(event) => {
            if (!dragging.current) return;
            aimAtPointer(event.clientX, event.clientY, true);
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          style={{
            position: 'relative',
            width: 220,
            height: 220,
            borderRadius: '50%',
            touchAction: 'none',
            cursor: 'crosshair',
            outlineOffset: 4,
            background: token.colorFillTertiary,
            border: `1px solid ${token.colorBorder}`,
            flex: 'none',
          }}
        >
          {(
            [
              ['N', '50%', '8%'],
              ['E', '91%', '50%'],
              ['S', '50%', '92%'],
              ['W', '9%', '50%'],
            ] as const
          ).map(([label, left, top]) => (
            <span
              key={label}
              style={{
                position: 'absolute',
                left,
                top,
                transform: 'translate(-50%, -50%)',
                color: token.colorTextSecondary,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {label}
            </span>
          ))}
          <svg
            viewBox="0 0 100 100"
            aria-hidden="true"
            style={{ width: '100%', height: '100%' }}
          >
            <circle
              cx="50"
              cy="50"
              r="35"
              fill="none"
              stroke={token.colorBorderSecondary}
            />
            <line
              x1="50"
              y1="50"
              x2={markerX}
              y2={markerY}
              stroke={token.colorPrimary}
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="50" cy="50" r="5" fill={token.colorPrimary} />
            <circle cx={markerX} cy={markerY} r="4" fill={token.colorPrimary} />
          </svg>
        </div>
        <div style={{ minWidth: 120, textAlign: 'center' }}>
          <Typography.Text
            strong
            style={{ display: 'block', fontVariantNumeric: 'tabular-nums' }}
          >
            {draft.yaw}° · {facing}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            style={{ display: 'block', marginTop: 6 }}
          >
            Up
          </Typography.Text>
          <Slider
            vertical
            min={-90}
            max={90}
            reverse
            value={draft.pitch}
            aria-label="Head pitch"
            onChange={(value) => {
              dragging.current = true;
              change({ ...draftRef.current, pitch: value });
            }}
            onChangeComplete={(value) => {
              change({ ...draftRef.current, pitch: value }, true);
              dragging.current = false;
            }}
            style={{ height: 140, margin: '12px auto' }}
          />
          <Typography.Text type="secondary" style={{ display: 'block' }}>
            Down
          </Typography.Text>
          <Typography.Text
            strong
            style={{
              display: 'block',
              marginTop: 6,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {Math.abs(draft.pitch)}° {pitchLabel(draft.pitch)}
          </Typography.Text>
        </div>
      </div>
    </section>
  );
}

export default MovementAim;
