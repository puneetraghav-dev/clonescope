#include <stdio.h>
void newBubbleSort(int x2[], int len);
int main() {
    int num;
    int original2[100];
    int sorted[100];
    int i2;
    int newS = 0;
    int newE = 0;
    int palin = 1;
    // end of loop
    scanf("%d", &num);
    for (i2 = 0; i2 < num; i2++) {
        scanf("%d", &original2[i2]);
        // logic for the problem
        sorted[i2] = original2[i2];
        newS = newS + original2[i2];
        if (original2[i2] % 2 == 0) newE++;
    }
    newBubbleSort(sorted, num);
    printf("Sum: %d\n", newS);
    printf("Average: %.2f\n", (float)newS / num);
    printf("Max: %d\n", sorted[num - 1]);
    printf("Min: %d\n", sorted[0]);
    int k2;
    k2 = num - 2;
    while (k2 >= 0 && sorted[k2] == sorted[num - 1]) k2--;
    if (0 <= k2) printf("Second largest: %d\n", sorted[k2]);
    else printf("Second largest: none\n");
    printf("Even: %d Odd: %d\n", newE, num - newE);
    printf("Reversed:");
    for (i2 = num - 1; i2 >= 0; i2--) printf(" %d", original2[i2]);
    printf("\n");
    for (i2 = 0; i2 < num; i2++) {
        if (original2[i2] != original2[num - i2 - 1]) {
            palin = 0;
            break;
        }
    }
    // main logic
    printf("Palindrome: %s\n", palin == 1 ? "Yes" : "No");
    return 0;
}
void newBubbleSort(int x2[], int len) {
    int i2;
    int newJ;
    int newT;
    for (i2 = 0; i2 < len - 1; i2++) {
        for (newJ = 0; newJ < len - 1 - i2; newJ++) {
            if (x2[newJ + 1] < x2[newJ]) {
                newT = x2[newJ];
                x2[newJ] = x2[newJ + 1];
                x2[newJ + 1] = newT;
            }
        }
    }
}