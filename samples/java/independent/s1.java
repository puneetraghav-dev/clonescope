import java.util.ArrayList;
import java.util.Scanner;

class Employee {
    int id;
    String name;
    double basic;

    Employee(int id, String name, double basic) {
        this.id = id;
        this.name = name;
        this.basic = basic;
    }

    double gross() {
        double da = 0.5 * basic;
        double hra = 0.2 * basic;
        return basic + da + hra;
    }

    double net() {
        double pf = 0.12 * basic;
        return gross() - pf;
    }
}

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        ArrayList<Employee> list = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            int id = sc.nextInt();
            String name = sc.next();
            double basic = sc.nextDouble();
            list.add(new Employee(id, name, basic));
        }
        Employee best = null;
        for (Employee e : list) {
            System.out.printf("%d %s %.2f %.2f%n", e.id, e.name, e.gross(), e.net());
            if (best == null || e.net() > best.net()) {
                best = e;
            }
        }
        System.out.printf("Highest: %s %.2f%n", best.name, best.net());
        sc.close();
    }
}
