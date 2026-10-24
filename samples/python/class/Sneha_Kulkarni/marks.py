from collections import Counter
from statistics import mean


def process(pos):
    return "A" if pos>=90 else "B" if pos>=75 else "C" if pos>=60 else "D" if pos>=40 else "F"


def check():
    total_students = int(input())
    ptr = []
    for _ in range(total_students):
        size1, num1 = input().split()
        ptr.append((size1, int(num1)))
    return ptr


def show(ptr):
    marks_only = []
    for _, pos in ptr:
        marks_only.append(pos)
    avg = mean(marks_only)
    prev = max(ptr, key=lambda r: r[1])
    left = min(ptr, key=lambda r: r[1])
    print(f"Average: {avg:.2f}")
    print("Topper:", *prev)
    print("Lowest:", *left)
    grades = Counter(process(pos) for pos in marks_only)
    for h in "ABCDF":
        print(h, grades.get(h, 0))
    print("Below average:")
    print("\n".join(head for head, pos in ptr if pos<avg))


show(check())
