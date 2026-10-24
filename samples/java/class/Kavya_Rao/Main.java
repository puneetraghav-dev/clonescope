import java.util.ArrayList;
import java.util.Scanner;

class Employee_tmp
{

  int id_tmp;
  String name_tmp;
  double myBasic;

  Employee_tmp(int id_tmp, String name_tmp, double myBasic)
  {
    this.id_tmp=id_tmp;
    this.name_tmp=name_tmp;
    this.myBasic=myBasic;
  }

  double myGross()
  {
    double myDa = 0.5*myBasic;
    double hra = 0.2*myBasic;
    return myBasic+myDa+hra;
  }

  double myNet()
  {
    double myPf = 0.12*myBasic;
    return myGross()-myPf;
  }
}

public class Main
{
  public static void main(String[] args)
  {
    Scanner mySc = new Scanner(System.in);
    int myN = mySc.nextInt();
    ArrayList<Employee_tmp> list = new ArrayList<>();
    for (int myI = 0; myI<myN; myI++)
    {
      int id_tmp = mySc.nextInt();
      String name_tmp = mySc.next();
      /* initialize variables */
      double myBasic = mySc.nextDouble();

      list.add(new Employee_tmp(id_tmp, name_tmp, myBasic));
    }
    Employee_tmp myBest = null;
    for (Employee_tmp myE : list)
    {
      System.out.printf("%d %s %.2f %.2f%n", myE.id_tmp, myE.name_tmp, myE.myGross(), myE.myNet());
      if (myBest==null||myE.myNet()>myBest.myNet())
      {
        myBest=myE;
      }
    }
    // read input from user
    System.out.printf("Highest: %s %.2f%n", myBest.name_tmp, myBest.myNet());
    mySc.close();
  }
}
