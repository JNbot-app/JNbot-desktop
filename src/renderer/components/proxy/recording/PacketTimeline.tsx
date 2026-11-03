import type React from 'react';
import { useRef, useEffect, useCallback, useState } from 'react';
import { useSettingsStore, selectAppSettings } from '../../../redux/settings';

interface RecordingPacket {
  n: string;
  dt: number;
  p: Record<string, any>;
  m: Record<string, any>;
}

interface PacketTimelineProps {
  packets: RecordingPacket[];
  currentTime: number;
  onTimeChange: (time: number) => void;
}

export const PacketTimeline: React.FC<PacketTimelineProps> = ({
  packets,
  currentTime,
  onTimeChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const theme = useSettingsStore(selectAppSettings)?.theme ?? 'dark';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const container = containerRef.current;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = 60;
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw timeline
    const totalDuration = packets[packets.length - 1]?.dt || 0;
    const timeToX = (time: number) => (time / totalDuration) * canvas.width;

    // Draw background
    ctx.fillStyle = theme === 'light' ? '#f0f0f0' : '#333';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw packet markers
    ctx.fillStyle = theme === 'light' ? '#1890ff' : '#4a90e2';
    packets.forEach((packet) => {
      const x = timeToX(packet.dt);
      ctx.fillRect(x, 20, 2, 20);
    });

    // Draw current time marker
    ctx.fillStyle = theme === 'light' ? '#ff4d4f' : '#ff7875';
    const currentX = timeToX(currentTime);
    ctx.fillRect(currentX - 1, 0, 2, canvas.height);

    // Draw time labels
    ctx.fillStyle = theme === 'light' ? '#000' : '#fff';
    ctx.font = '12px Arial';
    const numLabels = 5;
    for (let i = 0; i <= numLabels; i++) {
      const time = (totalDuration * i) / numLabels;
      const x = timeToX(time);
      const minutes = Math.floor(time / 60000);
      const seconds = Math.floor((time % 60000) / 1000);
      ctx.fillText(`${minutes}:${seconds.toString().padStart(2, '0')}`, x, 15);
    }
  }, [packets, currentTime, theme]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    handleMouseMove(e);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const totalDuration = packets[packets.length - 1]?.dt || 0;
    const newTime = (x / canvas.width) * totalDuration;

    onTimeChange(Math.max(0, Math.min(newTime, totalDuration)));
  };

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseUp]);

  return (
    <div ref={containerRef} style={{ marginBottom: 16 }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', cursor: 'pointer' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
      />
    </div>
  );
};
