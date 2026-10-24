import functools

# functional style solution


def parse(line):
    name, value = line.split()
    return name, int(value)


def band(value):
    limits = {"A": 90, "B": 75, "C": 60, "D": 40}
    for g, lim in limits.items():
        if value >= lim:
            return g
    return "F"


entries = list(map(parse, [input() for _ in range(int(input()))]))
values = list(map(lambda e: e[1], entries))
total = functools.reduce(lambda acc, v: acc + v, values, 0)
average = total / len(values)
best = functools.reduce(lambda p, q: p if p[1] >= q[1] else q, entries)
worst = functools.reduce(lambda p, q: p if p[1] <= q[1] else q, entries)

print("Average: {:.2f}".format(average))
print("Topper: {} {}".format(best[0], best[1]))
print("Lowest: {} {}".format(worst[0], worst[1]))
for g in "ABCDF":
    print(g, len(list(filter(lambda v: band(v) == g, values))))
print("Below average:")
for name in map(lambda e: e[0], filter(lambda e: e[1] < average, entries)):
    print(name)
