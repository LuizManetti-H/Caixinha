"""Regenera data/seeds.js e atualiza a revisão (rev) de cada viagem.

Uso:
    python tools/build_seeds.py

Rode isto sempre que editar manualmente os arquivos .json em /data.
A "rev" é um hash do conteúdo: quando muda, os navegadores re-sincronizam
automaticamente a viagem correspondente no próximo carregamento.
"""
import json
import hashlib
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")


def content_rev(trip):
    payload = {k: trip[k] for k in trip if k != "rev"}
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha1(blob).hexdigest()[:12]


def main():
    manifest = json.load(open(os.path.join(DATA, "trips.json"), encoding="utf-8"))
    trips = []
    for item in manifest.get("trips", []):
        path = os.path.join(DATA, item["file"])
        trip = json.load(open(path, encoding="utf-8"))
        trip["rev"] = content_rev(trip)
        json.dump(trip, open(path, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        trips.append(trip)

    body = json.dumps(trips, ensure_ascii=False, indent=2)
    out = ("/* Caixinha - seed embutido (gerado por tools/build_seeds.py).\n"
           " * Permite abrir o site via file:// e mantem as viagens de exemplo\n"
           " * sincronizadas por 'rev'. Nao edite a mao: rode o script novamente. */\n")
    out += "window.CAIXINHA_SEEDS = " + body + ";\n"
    open(os.path.join(DATA, "seeds.js"), "w", encoding="utf-8").write(out)
    print("Gerado seeds.js com %d viagem(ns):" % len(trips))
    for t in trips:
        print("  - %s (rev %s)" % (t["name"], t["rev"]))


if __name__ == "__main__":
    main()
