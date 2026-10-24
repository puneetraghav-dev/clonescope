import java.util.*;

public class Main {
    static int[] marks = {78, 92, 45, 66, 88, 39, 95};

    // returns the average
    static double average(int[] a) {
        int sum = 0;
        for (int i = 0; i < a.length; i++) {
            sum += a[i];
        }
        return (double) sum / a.length;
    }

    static int countAbove(int[] a, int limit) {
        int count = 0, j = 0;
        while (j < a.length) {
            if (a[j] > limit) {
                count++;
            }
            j = j + 1;
        }
        return count;
    }

    public static void main(String[] args) {
        double avg = average(marks);
        int above = countAbove(marks, 70);
        String label;
        if (avg > 70) {
            label = "good";
        } else {
            label = "average";
        }
        System.out.printf("%.2f %d %s%n", avg, above, label);
        for (int i = 0; i < marks.length; i++) {
            System.out.println(marks[i] * 2);
        }
    }
}
