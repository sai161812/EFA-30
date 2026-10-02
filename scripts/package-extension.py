"""Package and verify extension assets and public docs; no local profile data."""
from pathlib import Path
from hashlib import sha256
import json
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
output = root / "dist" / ("EFA-30-" + manifest["version"] + ".zip")
output.parent.mkdir(exist_ok=True)
documents = ["manifest.json", "usage_guide.md", "PROFILE_REFERENCE.md", "PRIVACY.md", "SECURITY_REVIEW.md", "PROTOTYPE_AUDIT.md"]
files = [root / name for name in documents]
files += sorted(file for file in (root / "extension").rglob("*") if file.is_file())
assets = {}
for file in files:
    relative = file.relative_to(root)
    if file.is_symlink() or not file.resolve().is_relative_to(root):
        raise ValueError("Package assets must resolve inside the repository.")
    if any(part.startswith(".") for part in relative.parts) or file.suffix not in {".js", ".html", ".css", ".json", ".md", ".png", ".svg"}:
        raise ValueError("Unexpected file in extension assets: " + relative.as_posix())
    assets[relative.as_posix()] = file.read_bytes()
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name, content in assets.items():
        archive.writestr(name, content)
with ZipFile(output) as archive:
    assert archive.testzip() is None, "Archive CRC verification failed"
    assert set(archive.namelist()) == set(assets), "Unexpected archive contents"
    for name, content in assets.items():
        assert archive.read(name) == content, "Packaged source differs: " + name
    packaged = json.loads(archive.read("manifest.json"))
    required = [packaged["background"]["service_worker"], packaged["action"]["default_popup"], packaged["options_page"], *packaged["icons"].values()]
    assert all(name in assets for name in required), "Missing manifest asset"
digest = sha256(output.read_bytes()).hexdigest()
output.with_suffix(".zip.sha256").write_text(digest + "  " + output.name + "\n", encoding="utf-8")
print(output)
print("Verified " + str(len(assets)) + " files; SHA-256 " + digest)
