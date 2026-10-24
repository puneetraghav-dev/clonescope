import java.util.*;
import java.util.stream.*;

public class Main {
    record Emp(int id, String name, double basic) {
        double gross() { return basic + basic * 0.5 + basic * 0.2; }
        double net() { return gross() - basic * 0.12; }
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        List<Emp> emps = IntStream.range(0, n)
                .mapToObj(i -> new Emp(sc.nextInt(), sc.next(), sc.nextDouble()))
                .collect(Collectors.toList());
        emps.forEach(e -> System.out.printf("%d %s %.2f %.2f%n", e.id(), e.name(), e.gross(), e.net()));
        emps.stream()
                .max(Comparator.comparingDouble(Emp::net))
                .ifPresent(e -> System.out.printf("Highest: %s %.2f%n", e.name(), e.net()));
        sc.close();
    }
}
