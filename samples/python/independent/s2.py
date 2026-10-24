"""Marks report using a dictionary of name -> marks."""

GRADES = [(90, "A"), (75, "B"), (60, "C"), (40, "D")]


def grade_of(score):
    for cutoff, letter in GRADES:
        if score >= cutoff:
            return letter
    return "F"


def summary(book):
    scores = list(book.values())
    mean = sum(scores) / len(scores)
    best = max(book, key=book.get)
    worst = min(book, key=book.get)
    return mean, best, worst


def main():
    count = int(input())
    book = {}
    for _ in range(count):
        name, score = input().split()
        book[name] = int(score)

    mean, best, worst = summary(book)
    print(f"Average: {mean:.2f}")
    print(f"Topper: {best} {book[best]}")
    print(f"Lowest: {worst} {book[worst]}")

    tally = {letter: 0 for letter in "ABCDF"}
    for score in book.values():
        tally[grade_of(score)] += 1
    for letter, k in tally.items():
        print(letter, k)

    below = [name for name, score in book.items() if score < mean]
    print("Below average:")
    for name in sorted(below):
        print(name)


if __name__ == "__main__":
    main()
