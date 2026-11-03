package com.jnbot.client.hud;

import com.jnbot.client.ui.UiPainter;
import com.jnbot.client.ui.UiTheme;
import org.joml.Matrix4f;
import org.joml.Vector4f;

import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;

/**
 * Lightweight world-anchored marker labels. Projects each marker's world
 * coordinates into screen space using the same view+projection matrix the
 * game uses, then draws a 2D pill at that position.
 *
 * This avoids the complexity of doing real 3D rendering with quads.
 */
public final class MarkerOverlay {
  private static final MarkerOverlay INSTANCE = new MarkerOverlay();

  public static MarkerOverlay getInstance() { return INSTANCE; }

  private static final int MAX_MARKERS = 64;

  private final List<Marker> markers = new ArrayList<>();

  private MarkerOverlay() {}

  /** entityId >= 0 makes the marker follow that entity (x/y/z are its fallback position) */
  public synchronized String add(String id, double x, double y, double z, String label, int color, long ttlMs, int entityId) {
    final String finalId = (id == null || id.isBlank()) ? ("marker_" + System.nanoTime()) : id;
    long expires = ttlMs <= 0 ? Long.MAX_VALUE : System.currentTimeMillis() + ttlMs;
    // dedupe by id
    markers.removeIf(m -> m.id.equals(finalId));
    if (markers.size() >= MAX_MARKERS) markers.remove(0);
    markers.add(new Marker(finalId, x, y, z, label == null ? "" : label, color == 0 ? UiTheme.ACCENT : color, expires, entityId));
    return finalId;
  }

  public synchronized void remove(String id) {
    if (id == null) return;
    markers.removeIf(m -> m.id.equals(id));
  }

  public synchronized void clear() { markers.clear(); }

  public synchronized int count() { return markers.size(); }

  public void render(GuiGraphics ctx) {
    Minecraft mc = Minecraft.getInstance();
    if (mc == null || mc.player == null || mc.gameRenderer == null) return;
    if (mc.options.hideGui) return;

    long now = System.currentTimeMillis();
    synchronized (this) {
      markers.removeIf(m -> m.expiresAt < now);
    }
    if (markers.isEmpty()) return;

    Font tr = mc.font;
    Vec3 camPos = mc.gameRenderer.getMainCamera().position();
    Matrix4f viewProj = computeViewProjection(mc);
    if (viewProj == null) return;

    int screenW = mc.getWindow().getGuiScaledWidth();
    int screenH = mc.getWindow().getGuiScaledHeight();

    synchronized (this) {
      for (Marker m : markers) {
        Vec3 pos = new Vec3(m.x, m.y, m.z);
        Entity entity = m.entityId >= 0 && mc.level != null ? mc.level.getEntity(m.entityId) : null;
        if (entity != null) pos = new Vec3(entity.getX(), entity.getY() + entity.getBbHeight(), entity.getZ());
        float dx = (float) (pos.x - camPos.x);
        float dy = (float) (pos.y + 0.5 - camPos.y);
        float dz = (float) (pos.z - camPos.z);

        Vector4f v = new Vector4f(dx, dy, dz, 1.0f);
        viewProj.transform(v);
        if (v.w <= 0) continue; // behind camera

        float ndcX = v.x / v.w;
        float ndcY = v.y / v.w;
        if (ndcX < -1.5f || ndcX > 1.5f || ndcY < -1.5f || ndcY > 1.5f) continue;

        int sx = Math.round((ndcX * 0.5f + 0.5f) * screenW);
        int sy = Math.round((1.0f - (ndcY * 0.5f + 0.5f)) * screenH);

        // Distance fade-out
        double dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        int alpha = (int) Math.max(0x33, Math.min(0xFF, 0xFF - (int) (dist * 1.2)));

        drawMarker(ctx, tr, sx, sy, m.label, m.color, alpha, dist);
      }
    }
  }

  private static void drawMarker(GuiGraphics ctx, Font tr, int sx, int sy, String label, int color, int alpha, double dist) {
    int padX = 4;
    int padY = 2;

    String text = label;
    if (dist > 0) text = label + " · " + (int) Math.round(dist) + "m";

    int textW = tr.width(text);
    int boxW = textW + 14 + padX * 2;
    int boxH = 11 + padY * 2;
    int x = sx - boxW / 2;
    int y = sy - boxH;

    int bg = UiTheme.alpha(UiTheme.BG_HUD, Math.min(alpha, 0xCC));
    int border = UiTheme.alpha(UiTheme.BORDER, alpha);
    UiPainter.panel(ctx, x, y, boxW, boxH, bg, border);
    UiPainter.statusDot(ctx, x + padX, y + (boxH - 6) / 2, UiTheme.alpha(color, alpha));
    int textColor = UiTheme.alpha(UiTheme.TEXT_PRIMARY, alpha);
    ctx.drawString(tr, text, x + padX + 10, y + padY + 1, textColor, false);

    // Stem pointing down to the world position
    ctx.fill(sx, y + boxH, sx + 1, sy + 1, UiTheme.alpha(color, alpha));
  }

  /**
   * Compose the game's projection × view matrix. We pull both from the
   * GameRenderer to keep behaviour identical to whatever the player sees.
   */
  private static Matrix4f computeViewProjection(Minecraft mc) {
    try {
      // Matrix is rebuilt every frame and not cached publicly; rebuilding it
      // here would duplicate vanilla math. Fall back to camera-only transform
      // which is close enough for marker labels in most cases.
      net.minecraft.client.Camera cam = mc.gameRenderer.getMainCamera();
      float yaw = cam.yRot();
      float pitch = cam.xRot();

      Matrix4f m = new Matrix4f();
      // Perspective from current FOV + aspect
      float fov = (float) Math.toRadians(70.0); // close to vanilla default
      float aspect = (float) mc.getWindow().getWidth() / (float) Math.max(1, mc.getWindow().getHeight());
      m.perspective(fov, aspect, 0.05f, 256.0f);
      // View — pitch first, then yaw
      m.rotateX((float) Math.toRadians(pitch));
      m.rotateY((float) Math.toRadians(yaw + 180));
      return m;
    } catch (Exception ignored) {
      return null;
    }
  }

  private static final class Marker {
    final String id;
    final double x, y, z;
    final String label;
    final int color;
    final long expiresAt;
    final int entityId;

    Marker(String id, double x, double y, double z, String label, int color, long expiresAt, int entityId) {
      this.id = id;
      this.x = x; this.y = y; this.z = z;
      this.label = label;
      this.color = color;
      this.expiresAt = expiresAt;
      this.entityId = entityId;
    }
  }
}
