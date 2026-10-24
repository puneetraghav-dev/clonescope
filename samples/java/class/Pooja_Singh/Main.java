import java.util.Scanner;

public class Main {
    static final double DA_RATE = 0.5;
    static final double HRA_RATE = 0.2;
    static final double PF_RATE = 0.12;

    static class Payslip {
        int id;
        String name;
        double gross, net;

        Payslip(int id, String name, double basic) {
            this.id = id;
            this.name = name;
            gross = basic * (1 + DA_RATE + HRA_RATE);
            net = gross - basic * PF_RATE;
        }

        @Override
        public String toString() {
            return id + " " + name + " " + String.format("%.2f %.2f", gross, net);
        }
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        Payslip[] slips = new Payslip[n];
        StringBuilder out = new StringBuilder();
        int maxAt = 0;
        for (int i = 0; i < slips.length; ++i) {
            slips[i] = new Payslip(sc.nextInt(), sc.next(), sc.nextDouble());
            out.append(slips[i]).append('\n');
            maxAt = slips[i].net > slips[maxAt].net ? i : maxAt;
        }
        out.append("Highest: ").append(slips[maxAt].name).append(' ').append(String.format("%.2f", slips[maxAt].net));
        System.out.println(out);
        sc.close();
    }
}
