import java.util.*;

interface Payable {
    double grossPay();
    double netPay();
}

abstract class Person {
    protected final String name;
    Person(String name) { this.name = name; }
    String getName() { return name; }
}

class Staff extends Person implements Payable {
    private final int code;
    private final double basicPay;
    private static final double DA = 0.50, HRA = 0.20, PF = 0.12;

    Staff(int code, String name, double basicPay) {
        super(name);
        this.code = code;
        this.basicPay = basicPay;
    }

    public double grossPay() { return basicPay * (1 + DA + HRA); }
    public double netPay() { return grossPay() - basicPay * PF; }
    int getCode() { return code; }
}

class PayrollService {
    private final List<Staff> staff = new ArrayList<>();

    void hire(Staff s) { staff.add(s); }

    void printSlips() {
        for (Staff s : staff) {
            System.out.println(String.format("%d %s %.2f %.2f", s.getCode(), s.getName(), s.grossPay(), s.netPay()));
        }
    }

    Staff highestPaid() {
        Staff top = staff.get(0);
        for (Staff s : staff) if (s.netPay() > top.netPay()) top = s;
        return top;
    }
}

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        PayrollService service = new PayrollService();
        while (n-- > 0) service.hire(new Staff(sc.nextInt(), sc.next(), sc.nextDouble()));
        service.printSlips();
        Staff top = service.highestPaid();
        System.out.println(String.format("Highest: %s %.2f", top.getName(), top.netPay()));
        sc.close();
    }
}
