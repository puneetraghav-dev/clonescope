#include <iostream>
#include <vector>
using namespace std;

// simple bank account
class Account {
public:
    int balance;
    Account(int b) { balance = b; }
    void deposit(int amt) { balance += amt; }
    bool withdraw(int amt) {
        if (amt > balance) {
            return false;
        } else {
            balance -= amt;
            return true;
        }
    }
};

int countEven(const vector<int>& v) {
    int c = 0;
    for (int i = 0; i < (int)v.size(); ++i) {
        if (v[i] % 2 == 0) c++;
    }
    return c;
}

int main() {
    Account acc(100);
    acc.deposit(50);
    vector<int> data = {1, 2, 3, 4, 5, 6};
    int evens = countEven(data), total = 0;
    for (int x : data) total += x;
    cout << acc.withdraw(30) << " " << acc.balance << " " << evens << " " << total << endl;
    return 0;
}
