import math


def to_finite_number(value):
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return num if math.isfinite(num) else None


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in km between two (lat, lon) pairs."""
    radius_km = 6371.0
    phi1 = math.radians(float(lat1))
    phi2 = math.radians(float(lat2))
    dphi = math.radians(float(lat2) - float(lat1))
    dlambda = math.radians(float(lon2) - float(lon1))
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius_km * math.asin(math.sqrt(a))


def estimate_delivery_metrics_from_radius(radius_km):
    """Return (distance_km, duration_minutes) estimate when precise coordinates are unavailable."""
    radius = to_finite_number(radius_km)
    if radius is None or radius <= 0:
        radius = 5.0
    distance_km = round(max(0.5, min(radius, radius * 0.6)), 2)
    duration_minutes = int(max(5, round(distance_km / 30 * 60 + 5)))
    return distance_km, duration_minutes
