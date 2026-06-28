#!/usr/bin/env python3
"""Diarizzazione locale con sherpa-onnx (chi parla quando).
Input: un wav 16 kHz mono. Output (stdout): JSON [{start,end,speaker}].
Nessun account/token: i modelli sono scaricati direttamente.

Uso:  diarize.py /path/audio.wav [--threshold 0.5] [--num-speakers N]
"""
import sys
import os
import json
import argparse

import numpy as np
import soundfile as sf
import sherpa_onnx

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
# Override (app Electron): VTE_DIARIZE_MODELS. Default: layout del progetto.
MODELS = os.environ.get("VTE_DIARIZE_MODELS") or os.path.join(ROOT, "models", "diarization")
SEG = os.path.join(MODELS, "sherpa-onnx-pyannote-segmentation-3-0", "model.onnx")
EMB = os.path.join(MODELS, "embedding.onnx")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--num-speakers", type=int, default=-1)
    args = ap.parse_args()

    if not (os.path.exists(SEG) and os.path.exists(EMB)):
        print("Modelli di diarizzazione mancanti in models/diarization/", file=sys.stderr)
        sys.exit(1)

    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=SEG),
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=EMB),
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=args.num_speakers,
            threshold=args.threshold,
        ),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    sd = sherpa_onnx.OfflineSpeakerDiarization(config)

    samples, sample_rate = sf.read(args.wav, dtype="float32", always_2d=False)
    if samples.ndim > 1:
        samples = samples[:, 0]  # mono
    if sample_rate != sd.sample_rate:
        print(f"Sample rate {sample_rate} != atteso {sd.sample_rate}", file=sys.stderr)
        sys.exit(1)

    result = sd.process(np.ascontiguousarray(samples)).sort_by_start_time()
    segments = [
        {"start": s.start, "end": s.end, "speaker": f"SPEAKER_{s.speaker:02d}"}
        for s in result
    ]
    json.dump(segments, sys.stdout)


if __name__ == "__main__":
    main()
