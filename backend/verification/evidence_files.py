"""Read and write the JSON evidence files that the verification scripts keep beside each E2E run."""
import json


def save(output, name, value):
    # "x" refuses to overwrite an earlier run's evidence.
    with (output / name).open("x", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2, default=str)


def load(output, name):
    return json.loads((output / name).read_text(encoding="utf-8"))
