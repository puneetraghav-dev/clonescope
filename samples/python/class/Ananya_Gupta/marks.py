n = int(input())
data = []
i = 0
while i < n:
    row = input().strip().split(" ")
    data.append([row[0], int(row[1])])
    i += 1

s = 0
hi = data[0]
lo = data[0]
j = 0
while j < n:
    s += data[j][1]
    if data[j][1] > hi[1]:
        hi = data[j]
    if data[j][1] < lo[1]:
        lo = data[j]
    j += 1
av = s / n
print("Average:", "%.2f" % av)
print("Topper:", hi[0], hi[1])
print("Lowest:", lo[0], lo[1])

a = b = c = d = f = 0
for rec in data:
    x = rec[1]
    if x >= 90:
        a += 1
    elif x >= 75:
        b += 1
    elif x >= 60:
        c += 1
    elif x >= 40:
        d += 1
    else:
        f += 1
print("A", a)
print("B", b)
print("C", c)
print("D", d)
print("F", f)
print("Below average:")
for rec in data:
    if rec[1] < av:
        print(rec[0])
