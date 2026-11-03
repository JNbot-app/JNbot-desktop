package com.jnbot.client.pathfinder;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

/**
 * A* pathfinding over block-grid nodes. Designed for short-to-medium hops
 * inside the loaded world (the only world we can read from the client).
 *
 * Movement model — from each node:
 *   walk: N/E/S/W
 *   jump+walk: up 1 then forward
 *   drop: down 1, 2, or 3 then forward (capped to avoid fall damage)
 *
 * Bounds:
 *   - maxNodes  hard ceiling on visited states (default 10000)
 *   - maxRange  euclidean cap from start (default 200 blocks)
 *
 * Cheap to call: returns a List<BlockPos> (or empty). No allocations after
 * the search except the result list.
 */
public final class Pathfinder {
  private static final int[][] CARDINALS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
  private static final int[][] FLIGHT_DIRECTIONS = {
      {1, 0, 0}, {-1, 0, 0}, {0, 0, 1}, {0, 0, -1}, {0, 1, 0}, {0, -1, 0}
  };
  private static final int MAX_DROP = 3;
  private static final int GOAL_SEARCH_RADIUS = 1;

  public enum Movement {
    WALK,
    FLY
  }

  public static final class Result {
    public final List<BlockPos> path;
    public final String failureReason;
    public final int visitedNodes;

    private Result(List<BlockPos> path, String failureReason, int visitedNodes) {
      this.path = path;
      this.failureReason = failureReason;
      this.visitedNodes = visitedNodes;
    }

    public static Result success(List<BlockPos> path, int visited) {
      return new Result(path, null, visited);
    }
    public static Result failure(String reason, int visited) {
      return new Result(Collections.emptyList(), reason, visited);
    }
    public boolean ok() { return failureReason == null; }
  }

  private final ClientLevel world;
  private final int maxNodes;
  private final double maxRange;
  private final Movement movement;
  private BlockPos searchStart;

  public Pathfinder(ClientLevel world, int maxNodes, double maxRange) {
    this(world, maxNodes, maxRange, Movement.WALK);
  }

  public Pathfinder(ClientLevel world, int maxNodes, double maxRange, Movement movement) {
    this.world = world;
    this.maxNodes = Math.max(64, maxNodes);
    this.maxRange = Math.max(2.0, maxRange);
    this.movement = movement != null ? movement : Movement.WALK;
  }

  public Result findPath(BlockPos start, BlockPos goal) {
    if (world == null || start == null || goal == null) {
      return Result.failure("invalid_input", 0);
    }
    if (start.equals(goal)) return Result.success(List.of(start), 0);

    double startDist = Math.sqrt(start.distSqr(goal));
    if (startDist > maxRange) {
      return Result.failure("out_of_range", 0);
    }

    searchStart = start.immutable();
    BlockPos normalisedGoal = movement == Movement.FLY ? settleInAir(goal) : settleNearGround(goal);
    if (normalisedGoal == null) {
      return Result.failure("goal_unreachable", 0);
    }

    Map<Long, Long> cameFrom = new HashMap<>();
    Map<Long, Double> gScore = new HashMap<>();
    PriorityQueue<Node> open = new PriorityQueue<>();

    long startKey = key(start);
    gScore.put(startKey, 0.0);
    double startHeuristic = heuristic(start, normalisedGoal);
    open.add(new Node(startKey, start.getX(), start.getY(), start.getZ(), 0.0, startHeuristic));

    int visited = 0;
    while (!open.isEmpty()) {
      Node current = open.poll();
      if (current.g > gScore.getOrDefault(current.key, Double.POSITIVE_INFINITY)) continue;
      visited++;
      if (visited > maxNodes) {
        return Result.failure("max_nodes_exceeded", visited);
      }

      if (current.x == normalisedGoal.getX() && current.y == normalisedGoal.getY() && current.z == normalisedGoal.getZ()) {
        return Result.success(reconstruct(cameFrom, current.key, start), visited);
      }

      if (movement == Movement.FLY) {
        for (int[] dir : FLIGHT_DIRECTIONS) {
          tryStep(current, dir[0], dir[1], dir[2], normalisedGoal, gScore, cameFrom, open, 1.0);
        }
      } else {
        for (int[] dir : CARDINALS) {
          tryStep(current, dir[0], 0, dir[1], normalisedGoal, gScore, cameFrom, open, 1.0);
          tryStep(current, dir[0], 1, dir[1], normalisedGoal, gScore, cameFrom, open, 1.5);
          for (int dy = -1; dy >= -MAX_DROP; dy--) {
            tryStep(current, dir[0], dy, dir[1], normalisedGoal, gScore, cameFrom, open, 1.0 + Math.abs(dy) * 0.1);
          }
        }
      }
    }

    return Result.failure("no_path", visited);
  }

  private void tryStep(Node from, int dx, int dy, int dz, BlockPos goal,
                       Map<Long, Double> gScore, Map<Long, Long> cameFrom,
                       PriorityQueue<Node> open, double stepCost) {
    int nx = from.x + dx;
    int ny = from.y + dy;
    int nz = from.z + dz;

    BlockPos next = new BlockPos(nx, ny, nz);
    if (next.distToCenterSqr(new Vec3(from.x, from.y, from.z)) > 4) {
      // safety: never overshoot per step
    }

    if (searchStart != null && Math.sqrt(searchStart.distSqr(next)) > maxRange) return;

    if (movement == Movement.FLY ? !isFlyable(next) : !isStandable(next)) return;

    // Vertical jump needs head clearance above 'from' as well
    if (dy > 0 && !isPassable(new BlockPos(from.x, from.y + 2, from.z))) return;
    // Drops need the trajectory column to be passable
    if (dy < 0) {
      for (int y = from.y; y > ny + 1; y--) {
        if (!isPassable(new BlockPos(nx, y, nz))) return;
      }
    }

    long nKey = key(next);
    double tentative = gScore.getOrDefault(from.key, Double.POSITIVE_INFINITY) + stepCost;
    if (tentative >= gScore.getOrDefault(nKey, Double.POSITIVE_INFINITY)) return;

    cameFrom.put(nKey, from.key);
    gScore.put(nKey, tentative);
    double h = heuristic(next, goal);
    open.add(new Node(nKey, nx, ny, nz, tentative, h));
  }

  /** True if the player can stand here: feet+head clear, ground below solid. */
  public boolean isStandable(BlockPos pos) {
    if (world == null) return false;
    if (world.isOutsideBuildHeight(pos.getY())) return false;
    BlockState below = world.getBlockState(pos.below());
    BlockState feet  = world.getBlockState(pos);
    BlockState head  = world.getBlockState(pos.above());
    if (below == null || feet == null || head == null) return false;
    if (isHazard(below) || isHazard(feet) || isHazard(head)) return false;
    if (below.getCollisionShape(world, pos.below()).isEmpty()) return false;
    if (!isPassableState(feet)) return false;
    if (!isPassableState(head)) return false;
    return true;
  }

  public boolean isPassable(BlockPos pos) {
    BlockState s = world.getBlockState(pos);
    return s != null && isPassableState(s);
  }

  /** True if the player's feet and head can occupy this position while flying. */
  public boolean isFlyable(BlockPos pos) {
    return world != null
        && !world.isOutsideBuildHeight(pos.getY())
        && !world.isOutsideBuildHeight(pos.getY() + 1)
        && isPassable(pos)
        && isPassable(pos.above());
  }

  private static boolean isPassableState(BlockState s) {
    if (s.isAir()) return true;
    if (!s.getFluidState().isEmpty()) return !s.is(Blocks.LAVA);
    // Treat replaceable blocks (tall grass, flowers, vines) as passable
    return s.canBeReplaced();
  }

  private static boolean isHazard(BlockState state) {
    return state.is(Blocks.LAVA) || state.is(Blocks.FIRE) || state.is(Blocks.SOUL_FIRE)
        || state.is(Blocks.CACTUS) || state.is(Blocks.MAGMA_BLOCK)
        || state.is(Blocks.CAMPFIRE) || state.is(Blocks.SOUL_CAMPFIRE)
        || state.is(Blocks.POWDER_SNOW);
  }

  /** Walk a position down until it's on solid ground, or return null. */
  public BlockPos settleOnGround(BlockPos pos) {
    BlockPos p = pos;
    for (int i = 0; i < 64; i++) {
      if (isStandable(p)) return p;
      if (world.isOutsideBuildHeight(p.getY() - 1)) return null;
      p = p.below();
    }
    return null;
  }

  /** Find the closest valid standing position near the requested goal. */
  private BlockPos settleNearGround(BlockPos pos) {
    BlockPos best = null;
    double bestDistance = Double.POSITIVE_INFINITY;
    for (int dx = -GOAL_SEARCH_RADIUS; dx <= GOAL_SEARCH_RADIUS; dx++) {
      for (int dz = -GOAL_SEARCH_RADIUS; dz <= GOAL_SEARCH_RADIUS; dz++) {
        BlockPos candidate = settleOnGround(pos.offset(dx, 0, dz));
        if (candidate == null) continue;
        double distance = candidate.distSqr(pos);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  /** Find the nearest vertically adjacent space that can contain a flying player. */
  private BlockPos settleInAir(BlockPos pos) {
    if (isFlyable(pos)) return pos;
    for (int distance = 1; distance <= 8; distance++) {
      BlockPos above = pos.above(distance);
      if (isFlyable(above)) return above;
      BlockPos below = pos.below(distance);
      if (isFlyable(below)) return below;
    }
    return null;
  }

  private double heuristic(BlockPos a, BlockPos b) {
    double dx = a.getX() - b.getX();
    double dy = a.getY() - b.getY();
    double dz = a.getZ() - b.getZ();
    if (movement == Movement.FLY) {
      return Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    }
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private static long key(BlockPos p) {
    // Pack 21-bit x, 21-bit y (signed shifted), 21-bit z into a long.
    long x = ((long) p.getX()) & 0x1FFFFF;
    long y = ((long) (p.getY() + (1 << 11))) & 0x1FFFFF;
    long z = ((long) p.getZ()) & 0x1FFFFF;
    return (x << 42) | (y << 21) | z;
  }

  private static List<BlockPos> reconstruct(Map<Long, Long> cameFrom, long endKey, BlockPos start) {
    List<BlockPos> reversed = new ArrayList<>();
    long cur = endKey;
    int safety = 0;
    while (true) {
      reversed.add(unkey(cur));
      Long prev = cameFrom.get(cur);
      if (prev == null) break;
      cur = prev;
      if (++safety > 200000) break;
    }
    Collections.reverse(reversed);
    if (!reversed.isEmpty() && reversed.get(0).equals(start)) {
      return reversed;
    }
    if (!reversed.isEmpty()) {
      List<BlockPos> withStart = new ArrayList<>(reversed.size() + 1);
      withStart.add(start);
      withStart.addAll(reversed);
      return withStart;
    }
    return reversed;
  }

  private static BlockPos unkey(long k) {
    int x = (int) ((k >> 42) & 0x1FFFFF);
    int y = (int) (((k >> 21) & 0x1FFFFF) - (1 << 11));
    int z = (int) (k & 0x1FFFFF);
    // sign-extend x and z (21 bits)
    if ((x & (1 << 20)) != 0) x |= ~0x1FFFFF;
    if ((z & (1 << 20)) != 0) z |= ~0x1FFFFF;
    return new BlockPos(x, y, z);
  }

  private static final class Node implements Comparable<Node> {
    final long key;
    final int x, y, z;
    final double g, h, f;

    Node(long key, int x, int y, int z, double g, double h) {
      this.key = key;
      this.x = x; this.y = y; this.z = z;
      this.g = g;
      this.h = h;
      this.f = g + h;
    }

    @Override
    public int compareTo(Node o) {
      int byCost = Double.compare(this.f, o.f);
      return byCost != 0 ? byCost : Double.compare(this.h, o.h);
    }
  }
}
