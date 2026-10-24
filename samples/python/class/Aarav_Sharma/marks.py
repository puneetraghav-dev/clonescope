# Lab 4 - Marks report
# Reads N students and prints a class report.

def get_grade(m):
    if m >= 90:
        return 'A'
    elif m >= 75:
        return 'B'
    elif m >= 60:
        return 'C'
    elif m >= 40:
        return 'D'
    else:
        return 'F'


def read_students():
    n = int(input())
    names = []
    marks = []
    for i in range(n):
        line = input().split()
        names.append(line[0])
        marks.append(int(line[1]))
    return names, marks


def report(names, marks):
    total = 0
    for m in marks:
        total = total + m
    avg = total / len(marks)
    top = 0
    low = 0
    for i in range(1, len(marks)):
        if marks[i] > marks[top]:
            top = i
        if marks[i] < marks[low]:
            low = i
    print("Average:", round(avg, 2))
    print("Topper:", names[top], marks[top])
    print("Lowest:", names[low], marks[low])
    counts = {'A': 0, 'B': 0, 'C': 0, 'D': 0, 'F': 0}
    for m in marks:
        counts[get_grade(m)] += 1
    for g in counts:
        print(g, counts[g])
    print("Below average:")
    for i in range(len(names)):
        if marks[i] < avg:
            print(names[i])


names, marks = read_students()
report(names, marks)
