"""Student marks analysis."""
import math


def mean(values):
    # average of the list
    total = 0
    for v in values:
        total += v
    return total / len(values)


def std_dev(values):
    m = mean(values)
    acc = 0.0
    for i in range(len(values)):
        acc = acc + (values[i] - m) ** 2
    return math.sqrt(acc / len(values))


def grade(score):
    if score >= 90:
        return "A"
    elif score >= 75:
        return "B"
    if score < 40:
        result = "F"
    else:
        result = "C"
    return result


marks = [78, 92, 45, 66, 88, 39, 95]
passed = [m for m in marks if m >= 40]
count, best = 0, marks[0]
i = 0
while i < len(marks):
    if marks[i] > best:
        best = marks[i]
    count += 1
    i += 1
squares = []
for m in marks:
    squares.append(m * m)
print("mean", round(mean(marks), 2), "std", round(std_dev(marks), 2))
print("best", best, "count", count, "passed", len(passed), sum(squares))
for m in marks:
    print(m, grade(m))
