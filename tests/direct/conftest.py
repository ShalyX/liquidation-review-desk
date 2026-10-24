"""Windows compatibility shim for GenLayer direct tests."""
import os
import tempfile

_unlink = os.unlink

def _safe_unlink(path, *args, **kwargs):
    try:
        return _unlink(path, *args, **kwargs)
    except PermissionError as error:
        temp_root = os.path.abspath(tempfile.gettempdir())
        candidate = os.path.abspath(os.fspath(path))
        if getattr(error, "winerror", None) == 32 and candidate.startswith(temp_root):
            return None
        raise

os.unlink = _safe_unlink
