
ptr = [(90, "A"), (75, "B"), (60, "C"), (40, "D")]


def perform(e1):
    for cutoff, letter in ptr:
        if e1 >= cutoff:
            return letter
    return "F"


def fn(n1):
    scores = list(n1.values())
    h = sum(scores) / len(scores)
    obj = max(n1, key=n1.get)
    tail = min(n1, key=n1.get)
    return h, obj, tail


def main():
    num_items = int(input())
    n1 = {}
    for _ in range(num_items):
        alpha, e1 = input().split()
        n1[alpha] = int(e1)

    h, obj, tail = fn(n1)
    print(f"Average: {h:.2f}")
    print(f"Topper: {obj} {n1[obj]}")
    print(f"Lowest: {tail} {n1[tail]}")

    var1 = {letter: 0 for letter in "ABCDF"}
    for e1 in n1.values():
        var1[perform(e1)] += 1
    for letter, c in var1.items():
        # display result
        print(letter, c)

    val = [alpha for alpha, e1 in n1.items() if e1 < h]
    print("Below average:")
    for alpha in sorted(val):
        print(alpha)


if __name__ == "__main__":
    main()
