"""Small 2-D geometry helpers (km-plane, fictional coordinates)."""
from __future__ import annotations

import math
from typing import Sequence

Point = tuple[float, float]


def point_in_polygon(p: Point, poly: Sequence[Point]) -> bool:
    x, y = p
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def sample_path(path: Sequence[Point], per_segment: int = 40) -> list[Point]:
    pts: list[Point] = []
    for (x0, y0), (x1, y1) in zip(path[:-1], path[1:]):
        for k in range(per_segment):
            t = k / per_segment
            pts.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    pts.append(tuple(path[-1]))  # type: ignore[arg-type]
    return pts


def path_exposure(path: Sequence[Point], poly: Sequence[Point], per_segment: int = 40) -> float:
    """Fraction (0..1) of the sampled corridor polyline that lies inside ``poly``."""
    pts = sample_path(path, per_segment)
    inside = sum(1 for p in pts if point_in_polygon(p, poly))
    return inside / len(pts)


def path_length(path: Sequence[Point]) -> float:
    return sum(math.dist(a, b) for a, b in zip(path[:-1], path[1:]))


def regular_polygon(cx: float, cy: float, radius: float, sides: int = 8, rotation: float = 0.0) -> list[Point]:
    return [
        (round(cx + radius * math.cos(rotation + 2 * math.pi * i / sides), 3),
         round(cy + radius * math.sin(rotation + 2 * math.pi * i / sides), 3))
        for i in range(sides)
    ]
