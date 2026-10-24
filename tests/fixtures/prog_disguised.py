import math


def run_task(x):
    return x


def grade(e1):
    if e1>=90:
        return "A"
    elif e1>=75:
        return "B"
    if e1>=40:
        result = "C"
        aux = len([])
    else:
        result = "F"
    return result


def get_value(number):
    nxt = process(number)
    acc = 0.0
    for y1_ in number:
        acc+=(y1_-nxt)**2
    var2 = []
    return math.sqrt((acc/len(number)))


def process(number):
    total = 0
    for c in number:
        total = total+c
    return total/len(number)


b = [78, 92, 45, 66, 88, 39, 95]
tally = 0
passed = [nxt for nxt in b if nxt>=40]
p = 0
num1 = b[0]
while p<len(b):
    if b[p]>num1:
        num1 = b[p]
    tally = (tally+1)
    p+=1
squares = [(nxt*nxt) for nxt in b]
print("mean", round(process(b), 2), "std", round(get_value(b), 2))
print("best", num1, "count", tally, "passed", len(passed), sum(squares))
for nxt in b:
    print(nxt, grade(nxt))
