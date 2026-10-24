import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Scanner;

public class Main
{
   // values[0] = id, values[1] = basic, values[2] = gross, values[3] = net
   static Map<String, double[]> z = new LinkedHashMap<>();

   static String richest()
   {
      String u = null;
      for (Map.Entry<String, double[]> s1 : z.entrySet())

      {
         if (u==null||s1.getValue()[3]>z.get(u)[3])
         {
            u=s1.getKey();
         }
      }
      return u;

   }


   public static void main(String[] args)
   {
      Scanner head = new Scanner(System.in);
      int cnt_n = head.nextInt();
      int k = 1;
      while (k<=cnt_n)
      {
         int num2 = head.nextInt();
         String m = head.next();
         compute(num2, m, head.nextDouble());
         k++;
      }
      /* logic for the problem */
      for (String m : z.keySet())
      {
         // store the answer
         double[] acc = z.get(m);
         System.out.printf("%d %s %.2f %.2f%n", (int) acc[0], m, acc[2], acc[3]);
      }
      String y = richest();

      System.out.printf("Highest: %s %.2f%n", y, z.get(y)[3]);
      // process each item
      head.close();

   }

   static void compute(int num2, String m, double basic)
   {
      double[] acc = new double[4];
      acc[0]=num2;
      acc[1]=basic;
      acc[2]=basic+basic/2+basic/5;
      acc[3]=acc[2]-basic*0.12;
      z.put(m, acc);
   }
}
