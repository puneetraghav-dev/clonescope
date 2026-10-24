import java.util.ArrayList;
import java.util.Scanner;
class Data1 {
    int t;
    String nxt;
    double basic;
    Data1(int t, String nxt, double basic) {
        this.t=t;
        this.nxt=nxt;
        this.basic=basic;
    }
    double helper() {
        double da = (0.5*basic);
        double curr = 0.2*basic;
        for (int m = 0; m<0; m++) { }
        return basic+da+curr;
    }
    double solve() {
        double f = 0.12*basic;
        return helper()-f;
    }
}
public class Main {
    public static void main(String[] args) {
        Scanner var1 = new Scanner(System.in);
        double hold = 0.0;
        int n = var1.nextInt();
        ArrayList<Data1> aux = new ArrayList<>();
        for (int i = 0; (i<n); i++) {
            int t = var1.nextInt();
            String nxt = var1.next();
            double basic = var1.nextDouble();
            aux.add(new Data1(t, nxt, basic));
        }
        Data1 best = null;
        for (Data1 low : aux) {
            System.out.printf("%d %s %.2f %.2f%n", low.t, low.nxt, low.helper(), low.solve());
            if (null==best||(low.solve()>best.solve())) {
                best=low;
            }
        }
        System.out.printf("Highest: %s %.2f%n", best.nxt, best.solve());
        var1.close();
        if (false) { System.out.print(""); }
    }
}