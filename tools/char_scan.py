import os
import yaml


def scan_characters(project_root):
    active_dir = os.path.join(project_root, "characters", "active")
    if not os.path.exists(active_dir):
        print("characters/active/ 目录不存在")
        return

    files = [
        f for f in os.listdir(active_dir)
        if f.endswith(".md") and os.path.isfile(os.path.join(active_dir, f))
    ]

    if not files:
        print("暂无活跃角色。")
        return

    print("=== 角色状态摘要 (v4 D20) ===\n")
    for fname in files:
        fpath = os.path.join(active_dir, fname)
        with open(fpath, "r", encoding="utf-8") as f:
            content = f.read()

        # Parse YAML frontmatter
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                try:
                    fm = yaml.safe_load(parts[1])
                except Exception:
                    fm = {}
            else:
                fm = {}
        else:
            fm = {}

        name = fm.get("name", fname.replace(".md", ""))
        lv = fm.get("level", "?")
        xp = fm.get("xp", "?")

        blood = fm.get("blood", {})
        blood_t = blood.get("total", "?")
        blood_l = blood.get("light", 0)
        blood_s = blood.get("severe", 0)
        blood_h = blood_t - blood_l - blood_s if isinstance(blood_t, int) else "?"

        energy = fm.get("energy", {})
        energy_c = energy.get("current", "?")
        energy_m = energy.get("max", "?")

        mods = fm.get("modifiers", {})
        str_m = mods.get("STR", "?")
        agi_m = mods.get("AGI", "?")

        print(f"角色：{name} | Lv{lv} | XP: {xp}")
        print(f"  血槽: H:{blood_h}/L:{blood_l}/S:{blood_s} (总{blood_t})")
        print(f"  能量: {energy_c}/{energy_m}")
        print(f"  属性修正: STR{str_m:+d} AGI{agi_m:+d}" if isinstance(str_m, int) else f"  属性: N/A")
        print()


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    scan_characters(project_root)


if __name__ == "__main__":
    main()
