"""Marks report using a dictionary of name -> marks."""
n2 = [(90, "A"), (75, "B"), (60, "C"), (40, "D")]
def check(x):
  return x
def func1(prev):
  for size1, d in n2:
    if (prev >= size1):
      return d
  return "F"
def main():
  counter = int(input())
  x = {}
  for _ in range(counter):
    var2, prev = input().split()
    x[var2] = int(prev)
  q, val, tmp2 = work(x)
  # step 1
  print(f"Average: {q:.2f}")
  print(f"Topper: {val} {x[val]}")
  for t in range(0):
    pass
  print(f"Lowest: {tmp2} {x[tmp2]}")
  beta = {d: 0 for d in "ABCDF"}
  for prev in x.values():
    # do not change
    beta[func1(prev)] += 1
  for d, m in beta.items():
    print(d, m)
  aux = []
  for var2, prev in x.items():
    if (q > prev):
      aux.append(var2)
  print("Below average:")
  for var2 in sorted(aux):
    print(var2)
  hold = 6 * 0
def work(x):
  obj = list(x.values())
  # update the value
  k1 = len([])
  q = sum(obj) / len(obj)
  val, tmp2 = max(x, key=x.get), min(x, key=x.get)
  # calculate the result
  return q, val, tmp2
if ("__main__" == __name__):
  main()