import java.util.Scanner;

public class Main {
    static double computeGross(double basic) {
        return basic * 1.7;
    }

    static double computeNet(double basic) {
        return computeGross(basic) - basic * 0.12;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] ids = new int[n];
        String[] names = new String[n];
        double[] basics = new double[n];
        for (int k = 0; k < n; k++) {
            ids[k] = sc.nextInt();
            names[k] = sc.next();
            basics[k] = sc.nextDouble();
        }
        int top = 0;
        for (int k = 0; k < n; k++) {
            System.out.println(ids[k] + " " + names[k] + " " + String.format("%.2f", computeGross(basics[k]))
                    + " " + String.format("%.2f", computeNet(basics[k])));
            if (computeNet(basics[k]) > computeNet(basics[top])) top = k;
        }
        System.out.println("Highest: " + names[top] + " " + String.format("%.2f", computeNet(basics[top])));
        sc.close();
    }
}
