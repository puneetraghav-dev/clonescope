import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Scanner;

public class Main {
    // values[0] = id, values[1] = basic, values[2] = gross, values[3] = net
    static Map<String, double[]> payroll = new LinkedHashMap<>();

    static void addEmployee(int id, String name, double basic) {
        double[] v = new double[4];
        v[0] = id;
        v[1] = basic;
        v[2] = basic + basic / 2 + basic / 5;
        v[3] = v[2] - basic * 0.12;
        payroll.put(name, v);
    }

    static String richest() {
        String who = null;
        for (Map.Entry<String, double[]> entry : payroll.entrySet()) {
            if (who == null || entry.getValue()[3] > payroll.get(who)[3]) {
                who = entry.getKey();
            }
        }
        return who;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        for (int i = 1; i <= n; i++) {
            int id = sc.nextInt();
            String name = sc.next();
            addEmployee(id, name, sc.nextDouble());
        }
        for (String name : payroll.keySet()) {
            double[] v = payroll.get(name);
            System.out.printf("%d %s %.2f %.2f%n", (int) v[0], name, v[2], v[3]);
        }
        String r = richest();
        System.out.printf("Highest: %s %.2f%n", r, payroll.get(r)[3]);
        sc.close();
    }
}
