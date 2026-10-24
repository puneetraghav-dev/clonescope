class Student:
    def __init__(self, name, marks):
        self.name = name
        self.marks = marks

    def grade(self):
        if self.marks >= 90:
            return "A"
        if self.marks >= 75:
            return "B"
        if self.marks >= 60:
            return "C"
        if self.marks >= 40:
            return "D"
        return "F"


class Classroom:
    def __init__(self):
        self.students = []

    def add(self, s):
        self.students.append(s)

    def average(self):
        return sum(s.marks for s in self.students) / len(self.students)

    def topper(self):
        best = self.students[0]
        for s in self.students:
            if s.marks > best.marks:
                best = s
        return best

    def lowest(self):
        return sorted(self.students, key=lambda s: s.marks)[0]

    def print_report(self):
        avg = self.average()
        t, l = self.topper(), self.lowest()
        print("Average: %.2f" % avg)
        print("Topper: %s %d" % (t.name, t.marks))
        print("Lowest: %s %d" % (l.name, l.marks))
        for g in ["A", "B", "C", "D", "F"]:
            print(g, len([s for s in self.students if s.grade() == g]))
        print("Below average:")
        for s in self.students:
            if s.marks < avg:
                print(s.name)


room = Classroom()
for _ in range(int(input())):
    parts = input().split()
    room.add(Student(parts[0], int(parts[1])))
room.print_report()
