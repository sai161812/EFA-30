"""Package extension assets only; never includes local browser profile data."""
from pathlib import Path
import json
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
output = root / "dist" / ("EFA-30-" + manifest["version"] + ".zip")
output.parent.mkdir(exist_ok=True)
files = [root / "manifest.json", root / "usage_guide.md", root / "PROFILE_REFERENCE.md"] + sorted((root / "extension").rglob("*"))
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for file in files:
        if file.is_file() and file.suffix in {".js", ".html", ".css", ".json", ".md", ".png", ".svg"}:
            archive.write(file, file.relative_to(root))
print(output)
