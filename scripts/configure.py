#!/usr/bin/env python3
"""Create local configuration only if absent; never overwrite credentials."""
import secrets
from pathlib import Path
root=Path(__file__).resolve().parents[1]
path=root/'.env'
if path.exists():
    print('.env already exists; left unchanged.')
else:
    password=secrets.token_hex(24)
    path.write_text((root/'.env.example').read_text().replace('local-development-change-before-deploy',password))
    path.chmod(0o600)
    print('Created private .env with a random database password. Configure OpenAI and production HTTPS as needed.')
