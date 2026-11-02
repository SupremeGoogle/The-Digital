# REVIEW — renders/digital-todo-promo.mp4

- 31.5 s, 1920×1080, 30 fps, H.264, 15.9 MB. `hyperframes check`: no errors left except intended sticker overlap in the chaos (opted out).
- Sound measured, not listened to: −14.3 LUFS integrated, true peak −2.7 dBFS, LRA 2.5 LU. No music (customer adds it). SFX at 0.10–0.22 volume; on SFX moments the peak stays at the voice level (−3…−4 dBFS).
- Voice: ElevenLabs v4 (Liam) via Router AI, ×1.12, each line −16 LUFS; Scribe transcript matches the script word for word.
- Checked frames: 0 (dense mess, not empty), 4.3, 7.5, 9.9/10.15 (bar = input, aligned), 11.6, 13.0, 14.4, 16.4, 17.85 (tick + site confetti), 19.0 (done, struck through), 20.6 (47 %, 9 из 19), 22.2, 24.2, 25.5, 26.3–26.85 (zoom into live 3D), 27.1 (iris), 27.6–31.3 (end card).
- Real data only: 18 demo tasks from the site, the new task's maths (8/18 → 9/19, 44 % → 47 %, Сделано 2 → 3), the assistant's own strings («Смотрю ваши задачи…», «с AI»), the answer built from real overdue/today tasks.
- Known false warning: `dead_stretch` 10.5–26.4 s — the motion is inside `#a-cam`, which is excluded from the layout audit.
- Rebuild after changing the site or Didi: `sh scripts/build.sh` (captured DOM in scripts/src, Didi pulled from js/assistant.js), then render.
