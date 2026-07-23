# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for bundling the Dionysus backend into one executable."""

from PyInstaller.building.build_main import Analysis, EXE, PYZ

block_cipher = None

a = Analysis(
    ['electron_entry.py'],
    pathex=[],
    binaries=[],
    datas=[('config', 'config')],
    hiddenimports=[
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops.auto',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets.auto',
        'fastapi',
        'pydantic',
        'pydantic_settings',
        'aiosqlite',
        'structlog',
        'qrcode',
        'PIL',
        'yaml',
        'dionysus_server.agent_adapters.strategies.kimi',
        'dionysus_server.agent_adapters.strategies.claude',
        'dionysus_server.agent_adapters.strategies.codex',
        'dionysus_server.agent_adapters.strategies.opencode',
        'dionysus_server.agent_adapters.strategies.codebuddy',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='dionysus_server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
