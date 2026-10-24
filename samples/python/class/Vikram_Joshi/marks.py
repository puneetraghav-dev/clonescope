import bisect

CUTS = [40, 60, 75, 90]
LETTERS = "FDCBA"


def grade(mark):
    return LETTERS[bisect.bisect_right(CUTS, mark)]


def read_input():
    size = int(input())
    pairs = []
    for idx in range(size):
        tokens = input().split()
        pairs.append((tokens[0], int(tokens[1])))
    return pairs


def stats(pairs):
    best_i, worst_i, running = 0, 0, 0
    for idx, (nm, mk) in enumerate(pairs):
        running += mk
        if mk > pairs[best_i][1]:
            best_i = idx
        if mk < pairs[worst_i][1]:
            worst_i = idx
    return running / len(pairs), pairs[best_i], pairs[worst_i]


pairs = read_input()
average, best, worst = stats(pairs)
print("Average: " + str(round(average, 2)))
print("Topper: " + best[0] + " " + str(best[1]))
print("Lowest: " + worst[0] + " " + str(worst[1]))
counts = [0] * 5
for nm, mk in pairs:
    counts[LETTERS.index(grade(mk))] += 1
for pos in range(4, -1, -1):
    print(LETTERS[pos], counts[pos])
print("Below average:")
for nm, mk in pairs:
    if mk < average:
        print(nm)
