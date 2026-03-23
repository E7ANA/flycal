"""Shared color mapping for subject display across exports.

Single source of truth for color keys, legacy hex→key mapping,
and resolution to bg/text/border triples.
"""

# Color key → full display definition (used by PDF export, could be used by frontend)
COLOR_KEY_MAP: dict[str, dict[str, str]] = {
    "coral":   {"bg": "#FDE8E4", "text": "#8B3A2F", "border": "#F0B8AD"},
    "purple":  {"bg": "#EDE5F5", "text": "#5B3A8C", "border": "#C9B3E0"},
    "teal":    {"bg": "#E8F0ED", "text": "#2D5E4F", "border": "#B5D5C8"},
    "success": {"bg": "#E8F1E4", "text": "#3D5A2E", "border": "#BCD8B0"},
    "warning": {"bg": "#FBF0E0", "text": "#6B4423", "border": "#E8D0A8"},
    "error":   {"bg": "#FAE0E4", "text": "#9B2C3B", "border": "#E8A8B4"},
    "blue":    {"bg": "#DEEAF6", "text": "#2C5F9B", "border": "#A8C8E8"},
}

DEFAULT_COLOR = COLOR_KEY_MAP["blue"]

# Legacy hex color → color key (for subjects imported with old hex values)
HEX_TO_KEY: dict[str, str] = {
    "#ef4444": "error", "#e11d48": "error", "#f43f5e": "error",
    "#dc2626": "error", "#c4342d": "error",
    "#ec4899": "coral", "#f97316": "coral", "#fb923c": "coral",
    "#8b5cf6": "purple", "#6366f1": "purple", "#7c3aed": "purple",
    "#a855f7": "purple", "#d946ef": "purple",
    "#10b981": "success", "#84cc16": "success", "#14b8a6": "success",
    "#2dd4bf": "teal", "#06b6d4": "teal", "#22d3ee": "teal", "#0ea5e9": "teal",
    "#f59e0b": "warning",
    "#3b82f6": "blue", "#1b365d": "blue",
}


def resolve_color(color_key: str | None) -> dict[str, str]:
    """Resolve a color key or legacy hex to {bg, text, border} dict."""
    if not color_key:
        return DEFAULT_COLOR
    if color_key in COLOR_KEY_MAP:
        return COLOR_KEY_MAP[color_key]
    mapped = HEX_TO_KEY.get(color_key.lower())
    if mapped:
        return COLOR_KEY_MAP[mapped]
    return DEFAULT_COLOR


def resolve_color_bg(color_key: str | None) -> str:
    """Resolve a color key or legacy hex to just the background hex color."""
    return resolve_color(color_key)["bg"]
