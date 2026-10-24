from collections import Counter
from statistics import mean


def letter(m):
    return "A" if m >= 90 else "B" if m >= 75 else "C" if m >= 60 else "D" if m >= 40 else "F"


def load():
    total_students = int(input())
    records = []
    for _ in range(total_students):
        who, mark = input().split()
        records.append((who, int(mark)))
    return records


def show(records):
    marks_only = [m for _, m in records]
    avg = mean(marks_only)
    top = max(records, key=lambda r: r[1])
    bottom = min(records, key=lambda r: r[1])
    print(f"Average: {avg:.2f}")
    print("Topper:", *top)
    print("Lowest:", *bottom)
    grades = Counter(letter(m) for m in marks_only)
    for g in "ABCDF":
        print(g, grades.get(g, 0))
    print("Below average:")
    print("\n".join(w for w, m in records if m < avg))


show(load())
