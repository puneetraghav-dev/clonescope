import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        String bestName = "";
        double bestNet = -1;
        int count = 0;
        while (count < n) {
            int empId = sc.nextInt();
            String empName = sc.next();
            double b = sc.nextDouble();
            double da = b * 50 / 100;
            double hra = b * 20 / 100;
            double pf = b * 12 / 100;
            double g = b + da + hra;
            double nt = g - pf;
            System.out.printf("%d %s %.2f %.2f\n", empId, empName, g, nt);
            if (nt > bestNet) {
                bestNet = nt;
                bestName = empName;
            }
            count++;
        }
        System.out.printf("Highest: %s %.2f\n", bestName, bestNet);
        sc.close();
    }
}
