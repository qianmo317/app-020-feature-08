/**
 * 出口服务分区与死端/最远点图面定位用例（验收标准：最远点与死端在图上点名，
 * 校验项任意一条可定位；多出口时各出口服务区与各自最远距离可分别核对）
 *
 * - exitServices：按「沿路径最近出口」把走道栅格划分到各出口，各出口最远之和的最大值
 *   必须等于整体 travelWorstM（同一栅格数据，无两套口径）；
 * - deadEndTip/deadEndPath：死端尽端点与「尽端 → 袋口」中心线路径，供图纸整段高亮；
 *   路径长度与 deadEndM 同口径（沿路径），端部小角落（≤3m）不出路径避免误报；
 * - DEADEND_EXCEED / NO_DOOR / EXIT_COUNT 等校验项必须带 point，面板点击才能居中定位。
 */
import { describe, it, expect } from 'vitest';
import { mkFloor, mkRoom, rect, validateFloor } from './helpers';
import { computeExitService } from '../src/lib/engine';
import { MM_PER_M } from '../src/lib/geometry';
import type { Pt } from '../src/model';

function pathLenM(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return s / MM_PER_M;
}

describe('出口服务分区', () => {
  it('E1 双出口 41m 走道：两出口分区相接于中点，各自最远 ≈20m，合起来 = 整体最远', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 41, 2))], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 40.5, y: 1 },
    ]);
    const r = validateFloor(floor, rules);
    const svc = r.exitServices!;
    expect(svc.length).toBe(2);
    // 与设施一一对应（面板按此着色/定位）
    expect(svc[0].facilityId).toBe(floor.facilities[0].id);
    expect(svc[1].facilityId).toBe(floor.facilities[1].id);
    for (const s of svc) {
      expect(s.worstM).toBeGreaterThan(19);
      expect(s.worstM).toBeLessThan(21);
      expect(s.worstPoint).not.toBeNull();
    }
    // 各出口最远中的最大者 = 走道网络整体最远（同一栅格口径）
    expect(Math.max(...svc.map((s) => s.worstM))).toBeCloseTo(r.travelWorstM!, 6);
  });

  it('E2 computeExitService：走道栅格按最近出口二分，房间归属到较近出口', () => {
    const { floor } = mkFloor(
      [
        mkRoom('走道', 'corridor', rect(0, 0, 40, 2)),
        mkRoom('西房', 'office', rect(2, 2, 6, 5)),
        mkRoom('东房', 'office', rect(32, 2, 6, 5)),
      ],
      [
        { kind: 'exit', x: 0.5, y: 1 },
        { kind: 'exit', x: 39.5, y: 1 },
      ],
    );
    const svc = computeExitService(floor);
    expect(svc.length).toBe(2);
    // 分区在中点（20.5m）附近相接，不重叠
    expect(Math.max(...svc[0].cells.map((c) => c.x))).toBeLessThanOrEqual(21000);
    expect(Math.min(...svc[1].cells.map((c) => c.x))).toBeGreaterThanOrEqual(20000);
    expect(svc[0].cells.length).toBeGreaterThan(0);
    expect(svc[1].cells.length).toBeGreaterThan(0);
    // 房间按门的最近出口归属
    const west = floor.rooms.find((r) => r.name === '西房')!;
    const east = floor.rooms.find((r) => r.name === '东房')!;
    expect(svc[0].roomIds).toContain(west.id);
    expect(svc[1].roomIds).toContain(east.id);
    expect(svc[0].roomIds).not.toContain(east.id);
    expect(svc[1].roomIds).not.toContain(west.id);
  });

  it('E3 开敞空间（无走道）单出口：服务区覆盖整个大厅，最远 ≈ 整体最远', () => {
    const { floor, rules } = mkFloor([mkRoom('大厅', 'other', rect(0, 0, 20, 15))], [
      { kind: 'exit', x: 10, y: 7.5 },
    ]);
    const r = validateFloor(floor, rules);
    expect(r.exitServices!.length).toBe(1);
    expect(r.exitServices![0].worstM).toBeCloseTo(r.travelWorstM!, 6);
    expect(r.exitServices![0].worstM).toBeGreaterThan(12);
  });

  it('E4 未连通出口不进服务区列表（另有 EXIT_NOT_CONNECTED 报错）', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 20, 2))], [
      { kind: 'exit', x: 10, y: 5 }, // 离走道 3m，连不上
    ]);
    const r = validateFloor(floor, rules);
    expect(r.items.some((i) => i.type === 'EXIT_NOT_CONNECTED')).toBe(true);
    expect(r.exitServices!.length).toBe(0);
  });
});

describe('死端（袋形走道）图面定位', () => {
  it('D1 单出口 30m 袋形走道：尽端点在西端，中心线路径 ≈ 死端长度，终点到出口', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 30, 2))], [
      { kind: 'exit', x: 29.5, y: 1 },
    ]);
    const r = validateFloor(floor, rules);
    expect(r.deadEndM!).toBeGreaterThan(29.0);
    // 尽端点在走道最西端（离出口最远的角落）
    expect(r.deadEndTip).not.toBeNull();
    expect(r.deadEndTip!.x).toBeLessThan(1000);
    // 中心线路径：尽端 → 袋口（单出口时袋口即出口），长度与 deadEndM 同口径
    const path = r.deadEndPath!;
    expect(path.length).toBeGreaterThan(50);
    expect(path[0]).toEqual(r.deadEndTip);
    expect(pathLenM(path)).toBeGreaterThan(r.deadEndM! - 1.5);
    expect(pathLenM(path)).toBeLessThan(r.deadEndM! + 1.5);
    const tail = path[path.length - 1];
    expect(tail.x).toBeGreaterThan(28000); // 袋口在出口旁
  });

  it('D2 T 形走道：死端路径整段落在袋形支路内（主走道东段），不越过分叉口', () => {
    const { floor, rules } = mkFloor(
      [mkRoom('主走道', 'corridor', rect(0, 0, 40, 2)), mkRoom('支走道', 'corridor', rect(19, 2, 2, 10))],
      [
        { kind: 'exit', x: 20, y: 11.5 },
        { kind: 'exit', x: 0.5, y: 1 },
      ],
    );
    const r = validateFloor(floor, rules);
    expect(r.deadEndM!).toBeGreaterThan(19.4);
    expect(r.deadEndM!).toBeLessThan(20.8);
    // 尽端在主走道东端（x≈40m），袋口在分叉处（x≈20m）
    expect(r.deadEndTip!.x).toBeGreaterThan(38000);
    const path = r.deadEndPath!;
    expect(Math.min(...path.map((p) => p.x))).toBeGreaterThan(18000);
    expect(pathLenM(path)).toBeGreaterThan(r.deadEndM! - 2);
    expect(pathLenM(path)).toBeLessThan(r.deadEndM! + 2);
  });

  it('D3 两端有出口的直走道：端部小角落（≤3m）不生成高亮路径，避免图面误报', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 50, 2))], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 49.5, y: 1 },
    ]);
    const r = validateFloor(floor, rules);
    expect(r.deadEndM!).toBeLessThan(2); // 数值仍如实上报
    expect(r.deadEndPath).toEqual([]);
    expect(r.deadEndTip).toBeNull();
  });
});

describe('校验项定位点（面板任意一条可居中定位）', () => {
  it('L1 DEADEND_EXCEED 带死端尽端点', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 30, 2))], [
      { kind: 'exit', x: 29.5, y: 1 },
    ]);
    const r = validateFloor(floor, rules);
    const item = r.items.find((i) => i.type === 'DEADEND_EXCEED');
    expect(item).toBeDefined();
    expect(item!.point).toBeDefined();
    expect(item!.point!.x).toBeLessThan(1000); // 尽端在西侧
  });

  it('L2 NO_DOOR 带房间中心点', () => {
    const { floor, rules } = mkFloor(
      [mkRoom('走道', 'corridor', rect(0, 0, 20, 2)), mkRoom('隔离房', 'storage', rect(0, 5, 5, 5))],
      [{ kind: 'exit', x: 19.5, y: 1 }],
    );
    const r = validateFloor(floor, rules);
    const item = r.items.find((i) => i.type === 'NO_DOOR');
    expect(item).toBeDefined();
    expect(item!.point).toBeDefined();
    expect(item!.point!.x).toBeGreaterThan(0);
    expect(item!.point!.x).toBeLessThan(5000);
    expect(item!.point!.y).toBeGreaterThan(5000);
  });

  it('L3 EXIT_COUNT（未布置出口 / 数量不足）带楼层中心点', () => {
    const noExit = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 20, 2))], []);
    const r1 = validateFloor(noExit.floor, noExit.rules);
    const i1 = r1.items.find((i) => i.type === 'EXIT_COUNT');
    expect(i1).toBeDefined();
    expect(i1!.point).toBeDefined();

    // 300㎡ 大厅只有 1 个出口 → 数量不足
    const big = mkFloor([mkRoom('大厅', 'other', rect(0, 0, 20, 15))], [{ kind: 'exit', x: 10, y: 7.5 }]);
    const r2 = validateFloor(big.floor, big.rules);
    const i2 = r2.items.find((i) => i.type === 'EXIT_COUNT');
    expect(i2).toBeDefined();
    expect(i2!.point).toBeDefined();
  });

  it('L4 所有校验项都带定位点（逐条核对，保证面板点击可定位）', () => {
    // 构造一个同时触发多类校验项的楼层
    const { floor, rules } = mkFloor(
      [mkRoom('走道', 'corridor', rect(0, 0, 30, 2)), mkRoom('隔离房', 'storage', rect(0, 5, 5, 5))],
      [
        { kind: 'exit', x: 29.5, y: 1 }, // 单出口 → 死端超限
        { kind: 'exit', x: 10, y: 6 }, // 未连通
      ],
    );
    const r = validateFloor(floor, rules);
    expect(r.items.length).toBeGreaterThan(0);
    for (const it of r.items) {
      expect(it.point, `${it.type} 缺定位点`).toBeDefined();
    }
  });
});
