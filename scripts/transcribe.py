#!/usr/bin/env python3
"""Transcreve uma gravação com Whisper local e devolve as palavras com tempo.

Uso: transcribe.py <arquivo> [--model small] [--language pt]
Saída (stdout, só JSON): {"language": "pt", "words": [{"w": "olá", "start": 0.0, "end": 0.4}, ...]}
Logs do Whisper vão para stderr.
"""
import argparse
import json
import sys

# Prompt com hesitações para o Whisper manter "é...", "tipo", "né" na transcrição
# (sem ele o modelo limpa a fala e o corte de vícios não tem o que cortar).
PROMPT = "Hum, é... então, tipo, eu, eu acho que... né? Ah, olha só."


def main():
    p = argparse.ArgumentParser()
    p.add_argument("path")
    p.add_argument("--model", default="small")
    p.add_argument("--language", default="pt")
    a = p.parse_args()

    import whisper

    model = whisper.load_model(a.model)
    r = model.transcribe(
        a.path,
        language=a.language,
        word_timestamps=True,
        initial_prompt=PROMPT,
        condition_on_previous_text=False,
        fp16=False,
        verbose=None,
    )
    words = [
        {"w": w["word"].strip(), "start": round(w["start"], 3), "end": round(w["end"], 3)}
        for s in r["segments"]
        for w in s.get("words", [])
        if w["word"].strip()
    ]
    json.dump({"language": r.get("language", a.language), "words": words}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
