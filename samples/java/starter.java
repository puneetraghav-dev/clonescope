import java.util.Scanner;

/*
 * Lab 6 - Payroll
 * Read N employees (id name basic) and print one payslip line per employee:
 *   DA = 50% of basic, HRA = 20% of basic, PF = 12% of basic
 *   gross = basic + DA + HRA, net = gross - PF
 * Output: id name gross net   (2 decimals)
 * Finally print the employee with the highest net salary.
 */
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        // TODO: read the employees and print the payslips
        sc.close();
    }
}
