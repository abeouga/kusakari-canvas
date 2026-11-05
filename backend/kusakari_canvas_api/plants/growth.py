"""Growth routines. Each builds one plant in a control box of height ``b.h`` and width ``b.w``.

Parameters come from ``b.s`` (resolved Shape) and ``b.t`` (Traits); species only add feature flags.
"""

import math

from .geometry import UP, add, bezier, normalize, on_curve, perpendiculars, radial, rotate, tangent

GOLDEN = 2.39996
TAU = math.tau
# Hard cap is 1500 parts per composition; leave room for ground connectors added to low leaves.
PART_BUDGET = 1400
PER_NODE = {"alternate": 1, "opposite": 2, "whorled": 3}


def grow(b):
    {"woody": woody, "herb": herb, "tuft": tuft, "rosette": rosette, "palm": palm}[b.t.architecture](b)


def bent_path(b, start, end, curve, segments):
    """A stem from ``start`` to ``end`` bowed sideways by ``curve`` (0 straight, 1 strongly bent)."""
    sway = b.rng.uniform(0, TAU)
    length = math.dist(start, end)
    u_axis, v_axis = perpendiculars((end[0] - start[0], end[1] - start[1], end[2] - start[2]))
    side = add((u_axis[0] * math.cos(sway), u_axis[1] * math.cos(sway), u_axis[2] * math.cos(sway)),
               v_axis, math.sin(sway))
    points = []
    for i in range(segments + 1):
        u = i / segments
        # Zero at both ends so the stem stays joined to its base and tip.
        bend = curve * length * math.sin(math.pi * u) * (0.16 + 0.04 * math.sin(3 * math.pi * u + sway))
        points.append(add(tuple(start[j] + (end[j] - start[j]) * u for j in range(3)), side, bend))
    return points


def rooted_stem(b, root, top, diameter, kind, segments=8):
    """Main stem: a short vertical collar keeps the cut base flat on the ground, then a bent, tapered path.

    The collar is at least 3/4 of the stem diameter, so the rim of a strongly leaning stem above it stays above
    ground on low, wide plants.
    """
    collar = (root[0], max(b.h * 0.04, diameter * 0.75), root[2])
    b.segment(root, collar, diameter, kind)
    return b.path(bent_path(b, collar, top, b.s.stem_curve, segments), diameter, b.s.stem_taper, kind)


def arc(b, start, azimuth, reach, angle, droop, segments):
    """A branch leaving ``start`` towards ``azimuth``; ``angle`` is from vertical, ``droop`` bends the tip down."""
    out = (math.cos(azimuth), 0.0, math.sin(azimuth))
    rise = min(reach / math.tan(math.radians(angle)), b.h * 0.25)
    end = add(start, out, reach)
    end = (end[0], max(start[1] + rise * (1 - droop) - droop * reach * 0.7, b.h * 0.03), end[2])
    control = add(start, out, reach * 0.5)
    control = (control[0], start[1] + rise * 0.75 + droop * reach * 0.3, control[2])
    return bezier(start, control, end, segments)


def foliage(b, path, start_u, nodes):
    """Leaves at ``nodes`` points along a shoot, arranged alternate / opposite / whorled around it."""
    per = PER_NODE[b.s.arrangement]
    step = GOLDEN if per == 1 else math.pi / per
    base = b.rng.uniform(0, TAU)
    for j in range(nodes):
        u = start_u + (1 - start_u) * (j + 0.5 + b.rng.uniform(-0.25, 0.25)) / nodes
        point, direction = on_curve(path, u), tangent(path, u)
        u_axis, v_axis = perpendiculars(direction)
        for k in range(per):
            phi = base + j * step + k * TAU / per
            side = add(tuple(c * math.cos(phi) for c in u_axis), v_axis, math.sin(phi))
            if "upright_leaves" in b.t.features:
                axis = add(UP, side, b.rng.uniform(0.12, 0.7))
            else:
                axis = add(side, UP, b.rng.uniform(0.15, 0.55))
            place_leaf(b, point, normalize(axis), side, b.leaf_size(u))


def place_leaf(b, point, axis, side, size, normal=(0, 1, 0)):
    if "petiole" in b.t.features:
        base = add(add(point, side, size * 0.2), UP, size * 0.05)
        b.segment(point, base, max(0.001, size * 0.02), "herb")
        point = base
    leaf = b.leaf(point, axis, size, normal)
    if "shoot_flowers" in b.t.features and b.t.flower_part and b.leaf_count % 4:
        # A flower head on top of the leafy shoot part, joined by a short stalk.
        stem_tip = add(leaf[1], rotate((0, leaf[3][1], 0), leaf[2]))
        tip = add(leaf[1], rotate((0, leaf[3][1] * 1.32, 0), leaf[2]))
        b.segment(stem_tip, tip, 0.0009, "herb")
        b.flower(tip, b.t.flower_size * b.rng.uniform(0.85, 1.12))


def crown_reach(b, q):
    """Horizontal branch reach at relative crown height ``q`` (0 bottom, 1 top)."""
    shape = "conical" if b.p.plantType == "conifer" else b.p.crownShape
    if shape == "conical":
        factor = 1.0 - 0.9 * q
    elif shape == "round":
        factor = math.sin(math.pi * (0.12 + 0.8 * q))
    else:
        factor = 1.0 - 0.35 * q
    return b.w * 0.5 * factor


def flower_tip(b, path):
    if not b.t.flower_part or "shoot_flowers" in b.t.features:
        return
    tip = path[-1]
    if "flower_stalks" in b.t.features:
        top = (tip[0], tip[1] + b.h * 0.12 * b.rng.uniform(0.8, 1.2), tip[2])
        b.segment(tip, top, 0.0015, "herb")
        tip = top
    b.flower(tip)


def crown_leaves(b):
    """Leaves needed to clothe the crown: crown surface / leaf area, scaled by density.

    Uses the requested size from the profile, not the control box, so part counts stay fixed while the
    envelope is fitted.
    """
    height, width = b.p.heightCm / 100, b.p.widthCm / 100
    area = math.pi * width / 2 * height * (1 - 0.8 * b.s.branch_start)
    part = b.catalog[b.t.leaf_parts[0]]
    blade = b.t.leaf_size ** 2 * max(0.25, part["baseDimensions"]["width"] / part["referenceLength"]) * 0.7
    return b.t.cover * area / blade


def twig_segments(levels):
    # Three-level crowns spend their budget on leaves rather than finely bent twigs.
    return 2 if levels == 3 else 3


def woody_plan(b, branches):
    """Twigs per branch and leaf nodes per shoot: enough leaves for the crown, within the part budget."""
    levels, petiole = b.s.branch_levels, "petiole" in b.t.features
    per_leaf = 1 + petiole + 2 * ("shoot_flowers" in b.t.features)
    flowers = 2 if "flower_stalks" in b.t.features else 1
    twigs, subtwigs = (0, 3, 3)[levels - 1], 2 if levels == 3 else 0
    per_node = PER_NODE[b.s.arrangement]

    def shoots():
        return branches * (1 + twigs + twigs * subtwigs)

    def total():
        segments = twig_segments(levels)
        stems = b.s.stem_count * 9 + branches * (4 + twigs * segments + twigs * subtwigs * segments)
        return stems + shoots() * (nodes * per_node * per_leaf + (flowers if b.t.flower_part else 0))

    nodes = round(crown_leaves(b) * b.s.node_factor / (shoots() * per_node))
    if levels > 1 and nodes > 10:
        twigs = 5
        nodes = round(crown_leaves(b) * b.s.node_factor / (shoots() * per_node))
    nodes = max(1, min(12 if levels > 1 else 20, nodes))
    while total() > PART_BUDGET and nodes > 1:
        nodes -= 1
    while total() > PART_BUDGET and (twigs > 1 or subtwigs > 0):
        subtwigs, twigs = (subtwigs - 1, twigs) if subtwigs else (0, twigs - 1)
    return twigs, subtwigs, nodes


def woody(b):
    s, h, w, rng = b.s, b.h, b.w, b.rng
    trunks = s.stem_count
    branches = b.t.branch_count * (2 if b.p.plantType == "conifer" else 1)
    twigs, subtwigs, nodes = woody_plan(b, branches)
    diameter = b.thickness / math.sqrt(trunks)
    per_trunk = [branches // trunks + (1 if k < branches % trunks else 0) for k in range(trunks)]
    shoots = []
    for k in range(trunks):
        a = k * GOLDEN + rng.uniform(-0.3, 0.3)
        lean = w * s.stem_spread * rng.uniform(0.7, 1.1) if trunks > 1 else 0.0
        top_y = h * (0.97 if trunks == 1 else rng.uniform(0.8, 0.97))
        root = radial(a, min(w * 0.03, lean * 0.15), 0.0)
        trunk = rooted_stem(b, root, radial(a, lean, top_y), diameter, "wood")
        count = max(1, per_trunk[k])
        for i in range(count):
            u = s.branch_start + (0.96 - s.branch_start) * (i + rng.uniform(0.2, 0.8)) / count
            q = (u - s.branch_start) / max(0.04, 0.96 - s.branch_start)
            azimuth = i * GOLDEN + k * 1.7 + rng.uniform(-0.45, 0.45)
            reach = crown_reach(b, q) * rng.uniform(0.8, 1.05)
            branch = arc(b, on_curve(trunk, u), azimuth, reach, b.t.branch_angle, s.branch_droop, 4)
            b.path(branch, diameter * (0.45 - 0.25 * q), 0.2 + 0.8 * s.stem_taper)
            shoots.append((branch, 0.15 if twigs == 0 else 0.45, nodes if twigs == 0 else max(1, nodes // 2)))
            side_shoots(b, branch, azimuth, reach, diameter * 0.2, twigs, subtwigs, nodes, shoots)
    for path, start_u, count in shoots:
        foliage(b, path, start_u, count)
        flower_tip(b, path)


def side_shoots(b, path, azimuth, length, diameter, twigs, subtwigs, nodes, shoots):
    for k in range(twigs):
        u = 0.3 + 0.65 * (k + b.rng.uniform(0.1, 0.9)) / twigs
        spin = azimuth + (0.85 if k % 2 else -0.85) + b.rng.uniform(-0.3, 0.3)
        reach = length * b.rng.uniform(0.3, 0.45) * b.s.twig_length
        twig = arc(b, on_curve(path, u), spin, reach, min(80.0, b.t.branch_angle + 10), b.s.branch_droop,
                   twig_segments(b.s.branch_levels))
        b.path(twig, diameter, 0.6)
        shoots.append((twig, 0.1, nodes))
        side_shoots(b, twig, spin, reach, diameter * 0.45, subtwigs, 0, nodes, shoots)


def herb(b):
    s, h, w, rng = b.s, b.h, b.w, b.rng
    if "single_leaf" in b.t.features:
        return crown_of_petioles(b)
    count = b.t.branch_count
    side = (0, 2, 2)[s.branch_levels - 1]
    per_node = PER_NODE[s.arrangement]
    nodes = b.t.leaf_nodes
    while nodes > 1 and count * (1 + side) * (nodes * per_node + 5) > PART_BUDGET:
        nodes -= 1
    stem = min(b.thickness * 0.3, h * 0.02)
    spread = math.tan(math.radians(b.t.branch_angle)) / math.tan(math.radians(45))
    for i in range(count):
        a = i * GOLDEN + rng.uniform(-0.2, 0.2)
        frac = (i + 1) / count
        reach = w * 0.42 * math.sqrt(frac) * min(1.4, 0.55 + 0.45 * spread)
        top = h * rng.uniform(0.7, 0.97) * {"round": math.sqrt(max(0.2, 1 - frac * 0.45)),
                                            "conical": 1 - frac * 0.5, "spreading": 0.6}[b.p.crownShape]
        end = radial(a, reach, max(h * 0.05, top * (1 - 0.45 * s.branch_droop)))
        # Stems rise from a small clump, not a single point.
        root = radial(a, w * 0.035 * math.sqrt(frac), 0.0)
        base = (root[0], h * 0.03, root[2])
        b.segment(root, base, stem, "herb")
        middle = tuple((base[j] + end[j]) / 2 for j in range(3))
        control = (middle[0], middle[1] + h * (0.03 + 0.2 * s.stem_curve) + s.branch_droop * top * 0.35, middle[2])
        path = b.path(bezier(base, control, end, 5), stem, s.stem_taper, "herb")
        foliage(b, path, s.branch_start, nodes)
        flower_tip(b, path)
        for k in range(side):
            u = 0.4 + 0.4 * (k + rng.uniform(0.1, 0.9)) / side
            start = on_curve(path, u)
            spin = a + (0.9 if k % 2 else -0.9) + rng.uniform(-0.3, 0.3)
            shoot = arc(b, start, spin, reach * 0.35 * s.twig_length, min(80.0, b.t.branch_angle + 15), s.branch_droop, 3)
            b.path(shoot, stem * 0.6, 0.6, "herb")
            foliage(b, shoot, 0.2, max(1, nodes // 2))
            flower_tip(b, shoot)


def crown_of_petioles(b):
    """Leaves on long petioles from a short climbing stem (monstera-like)."""
    s, h, w, rng = b.s, b.h, b.w, b.rng
    vine = rooted_stem(b, (0.0, 0.0, 0.0), (w * 0.06, h * 0.52, -w * 0.02), b.thickness, "herb", 4)
    count = max(3, round(b.t.branch_count * b.t.crown_leaves / 1.5))
    for i in range(count):
        t = i / max(1, count - 1)
        a = i * GOLDEN + rng.uniform(-0.38, 0.38)
        start = on_curve(vine, 0.25 + t * 0.73)
        end = radial(a, w * (0.19 + (1 - t) * 0.10), h * (0.24 + t * 0.44) * (1 - 0.3 * s.branch_droop))
        middle = tuple((start[j] + end[j]) / 2 for j in range(3))
        control = (middle[0], middle[1] + h * rng.uniform(0.02, 0.1), middle[2])
        b.path(bezier(start, control, end, 4), b.thickness * 0.34, 0.3, "herb")
        young = i == 0 and count > 4
        size = b.leaf_size(t) * (rng.uniform(0.50, 0.64) if young else 1.0)
        # Leaves face a shared light direction rather than a radial wheel.
        normal = (0.45 + math.cos(a) * 0.3, 0.25, 0.8 + math.sin(a) * 0.3)
        b.leaf(end, (math.cos(a) * 0.65, 0.35 + t * 0.45, math.sin(a) * 0.65), size, normal,
               "leaf-monstera-young" if young else None)
    if "aerial_roots" in b.t.features:
        for i in range(2):
            start = vine[i + 1]
            end = (start[0] + w * (0.07 if i else -0.05), 0.004, start[2] - w * 0.08)
            middle = tuple((start[j] + end[j]) / 2 for j in range(3))
            b.path(bezier(start, (middle[0], middle[1] - h * 0.01, middle[2]), end, 4), 0.0035, 0.0)


def tuft(b):
    s, h, w, rng = b.s, b.h, b.w, b.rng
    count = b.t.branch_count * (2 if "flow" in b.t.features else 1)
    nodes = b.t.leaf_nodes
    while nodes > 1 and count * (nodes + 7) > PART_BUDGET:
        nodes -= 1
    flow = rng.uniform(0, TAU)
    for i in range(count):
        a = i * GOLDEN + rng.uniform(-0.3, 0.3)
        r = math.sqrt((i + 0.5) / count)
        root = radial(a, w * 0.06 * r, 0.0)
        base = (root[0], h * 0.04, root[2])
        b.segment(root, base, 0.0025, "herb")
        reach = w * rng.uniform(0.18, 0.38)
        top = h * rng.uniform(0.65, 1.0) * (1 - 0.4 * s.branch_droop)
        end = (root[0] + math.cos(a) * reach, top, root[2] + math.sin(a) * reach)
        middle = tuple((base[j] + end[j]) / 2 for j in range(3))
        control = (middle[0], middle[1] + h * (0.04 + 0.16 * s.stem_curve) + s.branch_droop * h * 0.2, middle[2])
        path = b.path(bezier(base, control, end, 4), 0.002, 0.3, "herb")
        spin = a
        if "flow" in b.t.features:
            spin = math.atan2(math.sin(a) * 0.75 + math.sin(flow), math.cos(a) * 0.75 + math.cos(flow))
        for j in range(nodes):
            u = 0.03 + 0.97 * j / max(1, nodes - 1)
            angle = spin + (0.55 if j % 2 else -0.55) + rng.uniform(-0.2, 0.2)
            b.leaf(on_curve(path, u), UP, b.leaf_size(u), radial(angle, 1, 0))
        if i % 3 == 0:
            flower_tip(b, path)


def rosette(b):
    s, h, w, rng = b.s, b.h, b.w, b.rng
    count = max(3, round(b.t.branch_count * b.t.crown_leaves))
    per_leaf = 3 if "petiole" in b.t.features else 2
    count = min(count, (PART_BUDGET - 10) // per_leaf)
    b.segment((0, 0, 0), (0, h * 0.3, 0), min(0.012, h * 0.2), "herb")
    for i in range(count):
        t = i / count
        a = i * GOLDEN + rng.uniform(-0.1, 0.1)
        # Outer leaves sit further out; the reach scales with the box so any leaf size can be fitted.
        point = radial(a, w * 0.2 * (1 - 0.6 * t), h * (0.08 + 0.22 * t))
        b.segment((0, point[1] * 0.5, 0), point, 0.002, "herb")
        out = (math.cos(a), 0.0, math.sin(a))
        axis = normalize((out[0] * w, h * (0.25 + t * 1.4) * (1 - 0.6 * s.branch_droop), out[2] * w))
        place_leaf(b, point, axis, out, b.leaf_size(t))
    if b.t.flower_part:
        stalk = [(0, h * 0.3, 0), (0, h * 0.62, 0)]
        b.path(stalk, 0.003, 0.4, "herb")
        b.flower(stalk[-1])


def palm(b):
    s, h, w, rng = b.s, b.h, b.w, b.rng
    trunk = rooted_stem(b, (0.0, 0.0, 0.0), (0.0, h * 0.82, 0.0), b.thickness, "palm")
    crown = trunk[-1]
    count = max(3, round(b.t.branch_count * b.t.crown_leaves / 1.5))
    for i in range(count):
        a = i * GOLDEN + rng.uniform(-0.12, 0.12)
        end = add(radial(a, w * 0.30, 0.0), crown)
        end = (end[0], crown[1] + h * (rng.uniform(-0.02, 0.13) - 0.2 * s.branch_droop), end[2])
        middle = tuple((crown[j] + end[j]) / 2 for j in range(3))
        b.path(bezier(crown, (middle[0], middle[1] + h * 0.04, middle[2]), end, 3), b.thickness * 0.08, 0.5, "herb")
        axis = normalize((math.cos(a), rng.uniform(-0.1, 0.4) - 0.6 * s.branch_droop, math.sin(a)))
        b.leaf(end, axis, b.leaf_size(rng.random()))
