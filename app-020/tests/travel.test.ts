/**
 * 疏散距离验收用例（验收标准：20 组，路径距离与手工沿路径测量一致，误差 < 0.5m；
 * 且必须有一组证明「直线距离合格但路径距离超标」被判为不合规）
 *
 * 栅格 0.25m + 掩码 1 格膨胀：实测值相比手工值最多偏大 ~0.25m（最远点取在墙外侧一格），
 * 断言范围按 ±0.5m 容差给出。
 */
import { describe, it, expect } from 'vitest';
import { mkFloor, mkRoom, rect, ruleWith, validateFloor } from './helpers';
import { computeExitZones } from '../src/lib/engine';
import { MM_PER_M, dist } from '../src/lib/geometry';

const OFFICE = { maxTravelDistanceM: 40, deadEndDistanceM: 22 } as const;

function corridorWorstM(...args: Parameters<typeof validateFloor>): number {
  const r = validateFloor(...args);
  expect(r.travelWorstM).not.toBeNull();
  return r.travelWorstM!;
}

describe('疏散距离（沿路径）', () => {
  it('01 直线走道 20m，东端出口：最远 ≈19.5m', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 20, 2))], [
      { kind: 'exit', x: 19.5, y: 1 },
    ]);
    expect(corridorWorstM(floor, rules)).toBeGreaterThan(19.0);
    expect(corridorWorstM(floor, rules)).toBeLessThan(20.0);
  });

  it('02 直线走道 41m 两端出口：最远 ≈20m（中点到最近出口）', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 41, 2))], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 40.5, y: 1 },
    ]);
    const w = corridorWorstM(floor, rules);
    expect(w).toBeGreaterThan(19.5);
    expect(w).toBeLessThan(20.5);
  });

  it('03 L 形走道 30+20m 单出口：路径 ≈46.6m，远大于直线 34.4m（路径≠直线）', () => {
    const { floor, rules } = mkFloor(
      [mkRoom('横走道', 'corridor', rect(0, 0, 30, 2)), mkRoom('竖走道', 'corridor', rect(28, 0, 2, 20))],
      [{ kind: 'exit', x: 29, y: 19.5 }],
    );
    const w = corridorWorstM(floor, rules);
    // 手工沿路径：东行 28~29m 后折向北 18.5m ≈ 46.5~47.5（L 内角可行走，含斜切）
    expect(w).toBeGreaterThan(45.5);
    expect(w).toBeLessThan(47.6);
    const straight = dist({ x: 0, y: 1 * MM_PER_M }, { x: 29 * MM_PER_M, y: 19.5 * MM_PER_M }) / MM_PER_M;
    expect(straight).toBeLessThan(35); // 直线仅 ~34.4m
    expect(w - straight).toBeGreaterThan(10);
  });

  it('04 【关键】直线距离合格但路径距离超标 → 必须判不合规', () => {
    // L 形 30+25m，最远点 (0,1) 到出口直线 ≈37.3m ≤ 40（按直线会误判合格）
    // 沿路径 ≈ 50.5~52m > 40（必须判超标）
    const { floor, rules } = mkFloor(
      [mkRoom('横走道', 'corridor', rect(0, 0, 30, 2)), mkRoom('竖走道', 'corridor', rect(28, 0, 2, 25))],
      [{ kind: 'exit', x: 29, y: 24.5 }],
    );
    const r = validateFloor(floor, rules);
    expect(r.travelWorstM!).toBeGreaterThan(50.0);
    const straight = dist({ x: 0, y: 1 * MM_PER_M }, { x: 29 * MM_PER_M, y: 24.5 * MM_PER_M }) / MM_PER_M;
    expect(straight).toBeLessThanOrEqual(40); // 直线合格
    const exceed = r.items.filter((i) => i.type === 'TRAVEL_EXCEED');
    expect(exceed.length).toBeGreaterThan(0); // 路径超标 → 不合规
    expect(r.pass).toBe(false);
  });

  it('05 双出口房间走道：最远点位于中点附近', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 24, 2))], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 23.5, y: 1 },
    ]);
    const w = corridorWorstM(floor, rules);
    expect(w).toBeGreaterThan(11.2);
    expect(w).toBeLessThan(12.3);
  });

  it('06 房间经门接走道：最远点 = 房内直线段 + 门到出口路径 ≈43.9m（超 40）', () => {
    const { floor, rules } = mkFloor(
      [mkRoom('走道', 'corridor', rect(0, 0, 41, 2)), mkRoom('101', 'office', rect(0, 2, 8, 6))],
      [{ kind: 'exit', x: 40.5, y: 1 }],
    );
    const r = validateFloor(floor, rules);
    const room = r.items.find((i) => i.type === 'TRAVEL_EXCEED' && i.message.includes('101'));
    expect(room).toBeDefined();
    // 手工：房内最远角 (0,8)→门(4,2) 7.21m + 门→出口 36.75m = 43.96m
    expect(room!.value!).toBeGreaterThan(43.2);
    expect(room!.value!).toBeLessThan(44.8);
  });

  it('07 走道两端等距房间：房间 07A 比房间 07B 离出口更远（按路径排序）', () => {
    const { floor, rules } = mkFloor(
      [
        mkRoom('走道', 'corridor', rect(0, 0, 40, 2)),
        mkRoom('07A', 'office', rect(0, 2, 6, 5)),
        mkRoom('07B', 'office', rect(30, 2, 6, 5)),
      ],
      [{ kind: 'exit', x: 39.5, y: 1 }],
    );
    // 收紧限值到 10m，让两个房间都产生超限项以便对比
    const r = validateFloor(floor, ruleWith(rules, { maxTravelDistanceM: 10 }));
    const a = r.items.find((i) => i.message.includes('07A'));
    const b = r.items.find((i) => i.message.includes('07B'));
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // 07B 门在 x=33，07A 门在 x=3：07B 更近出口，差 ≈30m
    expect(b!.value!).toBeLessThan(a!.value!);
    expect(a!.value! - b!.value!).toBeGreaterThan(28);
    expect(a!.value! - b!.value!).toBeLessThan(31);
  });

  it('08 袋形走道 30m 单出口：死端 ≈29.5m 超 22m', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 30, 2))], [
      { kind: 'exit', x: 29.5, y: 1 },
    ]);
    const r = validateFloor(floor, rules);
    expect(r.deadEndM).not.toBeNull();
    expect(r.deadEndM!).toBeGreaterThan(29.0);
    expect(r.deadEndM!).toBeLessThan(30.2);
    expect(r.items.some((i) => i.type === 'DEADEND_EXCEED')).toBe(true);
  });

  it('09 袋形走道 20m 单出口：死端 ≈19.5m 未超 22m', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 20, 2))], [
      { kind: 'exit', x: 19.5, y: 1 },
    ]);
    const r = validateFloor(floor, rules);
    expect(r.deadEndM!).toBeLessThan(22);
    expect(r.items.some((i) => i.type === 'DEADEND_EXCEED')).toBe(false);
  });

  it('10 两端出口的 50m 走道：死端 ≈0（中点即分叉）', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 50, 2))], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 49.5, y: 1 },
    ]);
    const r = validateFloor(floor, rules);
    expect(r.deadEndM!).toBeLessThan(2);
  });

  it('11 T 形走道双出口：主走道两端形成各 ≈20m 袋形（端点到分叉点）', () => {
    // 出口在支走道顶部与主走道左端；主走道右段（分叉点 x≈20 → x=40）为 20m 袋形走道
    const { floor, rules } = mkFloor(
      [mkRoom('主走道', 'corridor', rect(0, 0, 40, 2)), mkRoom('支走道', 'corridor', rect(19, 2, 2, 10))],
      [
        { kind: 'exit', x: 20, y: 11.5 },
        { kind: 'exit', x: 0.5, y: 1 },
      ],
    );
    const r = validateFloor(floor, rules);
    expect(r.deadEndM).not.toBeNull();
    expect(r.deadEndM!).toBeGreaterThan(19.4);
    expect(r.deadEndM!).toBeLessThan(20.8);
  });

  it('12 开敞大空间（无走道）：房间内含出口，最远角 ≈12.5m', () => {
    const { floor, rules } = mkFloor([mkRoom('大厅', 'other', rect(0, 0, 20, 15))], [
      { kind: 'exit', x: 10, y: 7.5 },
    ]);
    const r = validateFloor(floor, rules);
    expect(r.travelWorstM!).toBeGreaterThan(12.2);
    expect(r.travelWorstM!).toBeLessThan(13.3);
  });

  it('13 房间与走道不共边 → NO_DOOR 警告', () => {
    const { floor, rules } = mkFloor(
      [mkRoom('走道', 'corridor', rect(0, 0, 20, 2)), mkRoom('隔离房', 'storage', rect(0, 5, 5, 5))],
      [{ kind: 'exit', x: 19.5, y: 1 }],
    );
    const r = validateFloor(floor, rules);
    expect(r.items.some((i) => i.type === 'NO_DOOR' && i.message.includes('隔离房'))).toBe(true);
  });

  it('14 出口远离走道 2.5m 外 → EXIT_NOT_CONNECTED', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 20, 2))], [
      { kind: 'exit', x: 10, y: 5 }, // 离走道 3m
    ]);
    const r = validateFloor(floor, rules);
    expect(r.items.some((i) => i.type === 'EXIT_NOT_CONNECTED')).toBe(true);
  });

  it('15 宽走道 4m（多行栅格）距离仍准确：30m 单出口 ≈29.5m', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 30, 4))], [
      { kind: 'exit', x: 29.5, y: 2 },
    ]);
    expect(corridorWorstM(floor, rules)).toBeGreaterThan(29.0);
    expect(corridorWorstM(floor, rules)).toBeLessThan(30.6);
  });

  it('16 Z 形（错位）走道：两段共边连接，路径 = 分段和', () => {
    // 下段 0..20，上段 y=2..4 且 x 从 18..40（共边 x=18..20 处连接）
    const { floor, rules } = mkFloor(
      [mkRoom('下段', 'corridor', rect(0, 0, 20, 2)), mkRoom('上段', 'corridor', rect(18, 2, 22, 2))],
      [{ kind: 'exit', x: 39.5, y: 3 }],
    );
    const r = validateFloor(floor, rules);
    // 最远 (0,1)：路径 19+1.0(斜接)+21.5 ≈ 41.5m（手工沿路径）
    expect(r.travelWorstM!).toBeGreaterThan(40.2);
    expect(r.travelWorstM!).toBeLessThan(42.3);
  });

  it('17 多出口取最近：房间到两端出口各算，取最小', () => {
    const { floor, rules } = mkFloor(
      [mkRoom('走道', 'corridor', rect(0, 0, 40, 2)), mkRoom('侧房', 'office', rect(18, 2, 4, 4))],
      [
        { kind: 'exit', x: 0.5, y: 1 },
        { kind: 'exit', x: 39.5, y: 1 },
      ],
    );
    const r = validateFloor(floor, rules);
    // 房间门 x=20 → 到任一出口 19.5+0.25；房内最远角 (18,6)/(22,6) 距门 √(16+12.25)≈5.4
    const item = r.items.find((i) => i.message.includes('侧房') && i.type === 'TRAVEL_EXCEED');
    expect(item).toBeUndefined(); // ≈25.2m < 40
    expect(r.travelWorstM!).toBeLessThan(21);
  });

  it('18 房间内自含出口（尽端房）：只算房内直线', () => {
    const { floor, rules } = mkFloor(
      [mkRoom('走道', 'corridor', rect(0, 0, 20, 2)), mkRoom('尽端房', 'storage', rect(0, 2, 6, 4))],
      [
        { kind: 'exit', x: 19.5, y: 1 },
        { kind: 'exit', x: 3, y: 4 }, // 房间内出口
      ],
    );
    const r = validateFloor(floor, rules);
    // 尽端房最远角 (0,6)→(3,4) ≈3.6m ≤ 40 → 无超限
    expect(r.items.find((i) => i.message.includes('尽端房') && i.type === 'TRAVEL_EXCEED')).toBeUndefined();
  });

  it('19 非凸房间（L 形房）最远顶点被精确测到', () => {
    // L 形房：主体 x∈[0,10] y∈[2,7]，塔部 x∈[8,10] y∈[7,10]
    const L = [
      { x: 0, y: 2 * MM_PER_M },
      { x: 10 * MM_PER_M, y: 2 * MM_PER_M },
      { x: 10 * MM_PER_M, y: 10 * MM_PER_M },
      { x: 8 * MM_PER_M, y: 10 * MM_PER_M },
      { x: 8 * MM_PER_M, y: 7 * MM_PER_M },
      { x: 0, y: 7 * MM_PER_M },
    ];
    const { floor, rules } = mkFloor(
      [mkRoom('走道', 'corridor', rect(0, 0, 41, 2)), mkRoom('L房', 'office', L)],
      [{ kind: 'exit', x: 40.5, y: 1 }],
    );
    const r = validateFloor(floor, rules);
    const item = r.items.find((i) => i.message.includes('L房'));
    expect(item).toBeDefined();
    // 最远点 (10,10)→门(5,2) ≈9.43 + 门→出口 35.75 ≈45.2
    expect(item!.value!).toBeGreaterThan(44.2);
    expect(item!.value!).toBeLessThan(46.3);
  });

  it('20 限值收紧后同一楼层结论翻转（travel 限值 30）', () => {
    // 70m 走道双出口：travelWorst ≈35m；灭火器对称布置保证覆盖合规，结论差异只来自限值
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 70, 2))], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 69.5, y: 1 },
      { kind: 'extinguisher', x: 17.5, y: 1 },
      { kind: 'extinguisher', x: 52.5, y: 1 },
    ]);
    const r1 = validateFloor(floor, ruleWith(rules, { maxTravelDistanceM: 40 }));
    expect(r1.pass).toBe(true);
    const r2 = validateFloor(floor, ruleWith(rules, { maxTravelDistanceM: 30 }));
    expect(r2.pass).toBe(false);
    expect(r2.items.some((i) => i.type === 'TRAVEL_EXCEED')).toBe(true);
    expect(OFFICE.maxTravelDistanceM).toBe(40); // 文档常量核对
  });
});

describe('最远点 / 死端 / 出口分区的图上点名数据', () => {
  const meanX = (pts: { x: number }[]) => pts.reduce((s, p) => s + p.x, 0) / pts.length / MM_PER_M;

  it('21 单出口直走道：死端路径从袋底（西端）回溯到袋口（出口），长度≈死端值', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 30, 2))], [
      { kind: 'exit', x: 29.5, y: 1 },
    ]);
    const r = validateFloor(floor, rules);
    expect(r.deadEnd).toBeTruthy();
    const d = r.deadEnd!;
    expect(d.tip.x).toBeLessThan(2 * MM_PER_M); // 袋底在西端
    expect(d.mouth.x).toBeGreaterThan(27 * MM_PER_M); // 袋口在出口附近
    expect(d.path.length).toBeGreaterThan(80); // 0.25m 栅格，30m ≈ 120 点
    expect(d.lengthM).toBeCloseTo(r.deadEndM!, 6);
    // 路径单调向东（tip → mouth）
    for (let i = 1; i < d.path.length; i++) expect(d.path[i].x).toBeGreaterThanOrEqual(d.path[i - 1].x - 1);
    // DEADEND_EXCEED 校验项必须带定位点，且就指在袋底
    const item = r.items.find((i) => i.type === 'DEADEND_EXCEED');
    expect(item?.point).toBeTruthy();
    expect(dist(item!.point!, d.tip)).toBeLessThan(MM_PER_M);
  });

  it('22 T 形走道：死端段是主走道右段，袋口在分叉点附近，路径不串入支走道', () => {
    const { floor, rules } = mkFloor(
      [mkRoom('主走道', 'corridor', rect(0, 0, 40, 2)), mkRoom('支走道', 'corridor', rect(19, 2, 2, 10))],
      [
        { kind: 'exit', x: 20, y: 11.5 },
        { kind: 'exit', x: 0.5, y: 1 },
      ],
    );
    const r = validateFloor(floor, rules);
    const d = r.deadEnd!;
    expect(d.tip.x).toBeGreaterThan(38 * MM_PER_M); // 袋底在主走道东端
    expect(Math.abs(d.mouth.x / MM_PER_M - 20)).toBeLessThan(2.5); // 袋口 ≈ 分叉点
    // 整段都在主走道及分叉口附近（支走道向北延伸 10m，路径不会深入）
    for (const p of d.path) expect(p.y).toBeLessThan(3.5 * MM_PER_M);
    // 路径里程 ≈ 袋深 20m（0.25m 栅格）
    expect(d.path.length).toBeGreaterThan(60);
    expect(d.path.length).toBeLessThan(100);
  });

  it('23 双出口直走道：两区各服务约一半，最远 ≈20m，分区不重不漏', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 41, 2))], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 40.5, y: 1 },
    ]);
    const r = validateFloor(floor, rules);
    expect(r.exitZones).toHaveLength(2);
    for (const z of r.exitZones!) {
      expect(z.farthestM).toBeGreaterThan(19.5);
      expect(z.farthestM).toBeLessThan(20.8);
      // 每区最远点都在中线 x≈20.5m 附近
      expect(z.farthestPoint.x / MM_PER_M).toBeGreaterThan(19);
      expect(z.farthestPoint.x / MM_PER_M).toBeLessThan(22);
    }
    // 图上着色：每格恰好属于一个出口，两区在中线分界
    const zones = computeExitZones(floor);
    expect(zones).toHaveLength(2);
    expect(zones.every((z) => z.cells.length > 0)).toBe(true);
    expect(Math.abs(zones[0].cells.length - zones[1].cells.length)).toBeLessThan(zones[0].cells.length * 0.25);
    expect(meanX(zones[0].cells)).toBeLessThan(meanX(zones[1].cells)); // 西出口区整体偏西
  });

  it('24 单出口只产生一个分区；未连通出口不进分区', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 20, 2))], [
      { kind: 'exit', x: 19.5, y: 1 },
      { kind: 'exit', x: 10, y: 5 }, // 离走道 3m，未连通
    ]);
    const r = validateFloor(floor, rules);
    expect(r.exitZones).toHaveLength(1);
    expect(r.exitZones![0].farthestM).toBeGreaterThan(19);
    expect(r.exitZones![0].farthestPoint.x).toBeLessThan(2 * MM_PER_M);
    const zones = computeExitZones(floor);
    expect(zones).toHaveLength(1);
  });

  it('25 校验项均带图上定位点（死端 / 无门 / 无出口）', () => {
    const f1 = mkFloor(
      [mkRoom('走道', 'corridor', rect(0, 0, 20, 2)), mkRoom('隔离房', 'storage', rect(0, 5, 5, 5))],
      [{ kind: 'exit', x: 19.5, y: 1 }],
    );
    const r1 = validateFloor(f1.floor, f1.rules);
    const noDoor = r1.items.find((i) => i.type === 'NO_DOOR')!;
    expect(noDoor.point).toBeTruthy();
    expect(noDoor.point!.x / MM_PER_M).toBeCloseTo(2.5, 0); // 房间中心
    expect(noDoor.point!.y / MM_PER_M).toBeCloseTo(7.5, 0);

    const f2 = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 20, 2))], []);
    const r2 = validateFloor(f2.floor, f2.rules);
    const noExit = r2.items.find((i) => i.type === 'EXIT_COUNT')!;
    expect(noExit.point).toBeTruthy();
    expect(noExit.point!.x / MM_PER_M).toBeCloseTo(10, 0); // 楼层中心
  });
});
