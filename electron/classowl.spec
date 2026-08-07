from pathlib import Path

root = Path(SPECPATH).resolve().parent

a = Analysis(
    [str(root / "backend" / "classowl" / "__main__.py")],
    pathex=[str(root / "backend")],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="classowl",
    console=True,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="classowl",
)
